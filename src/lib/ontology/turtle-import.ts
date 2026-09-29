import { Parser, Store, DataFactory, type Quad_Object, type Quad_Subject } from 'n3'

// Ember's "import an attached ontology file" (src/lib/chat/ontology-file-
// import-tool.ts). Turns a Turtle ontology into the staged object tree the
// project Ontology Map stores (project_objects), deterministically -- the
// chat model only presents the result and relays the user's confirmation;
// it never rebuilds the tree itself, which a small model couldn't do
// reliably for a file with dozens of classes.
//
// Mapping:
// - every owl:Class / rdfs:Class (named, outside the standard vocabularies)
//   becomes an object; its first superclass that is also one of those
//   classes becomes its parent (others are noted as "Also a kind of");
// - named individuals of a class are listed as "Values" in its description
//   rather than becoming objects (instances, not types);
// - if the file is organised by numbered comment headers ("# 1. ACTORS"),
//   classes with no parent are grouped under one object per section, so the
//   map isn't dozens of unconnected roots;
// - properties, restrictions and axioms have no place on the map and are
//   only counted.

const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#'
const OWL = 'http://www.w3.org/2002/07/owl#'
const SKOS = 'http://www.w3.org/2004/02/skos/core#'
const SH = 'http://www.w3.org/ns/shacl#'
const STANDARD_NAMESPACES = [RDF, RDFS, OWL, SKOS, SH, 'http://www.w3.org/2001/XMLSchema#', 'http://purl.org/dc/terms/', 'http://purl.org/dc/elements/1.1/']

export const MAX_IMPORT_OBJECTS = 400
const MAX_VALUES_LISTED = 15

export interface OntologyImportItem {
  tempId: string
  parentTempId: string | null
  name: string
  description: string
}

export interface OntologyImportPlan {
  items: OntologyImportItem[]
  classCount: number
  groupCount: number
  // Counted, not imported -- the map has nowhere to put them.
  propertyCount: number
  shapeCount: number
}

export class OntologyImportError extends Error {}

const { namedNode } = DataFactory

function localName(iri: string): string {
  const cut = Math.max(iri.lastIndexOf('#'), iri.lastIndexOf('/'))
  return cut >= 0 ? iri.slice(cut + 1) : iri
}

function isStandard(iri: string): boolean {
  return STANDARD_NAMESPACES.some((ns) => iri.startsWith(ns))
}

// Short all-caps words in a section header that are ordinary English, not
// acronyms -- everything else of 2-3 capitals (CP, AI, API) stays as is.
const SMALL_WORDS = new Set(['A', 'AN', 'AND', 'AS', 'AT', 'BY', 'FOR', 'IN', 'OF', 'ON', 'OR', 'PER', 'THE', 'TO', 'VIA', 'VS'])

// "ACTORS AND ACCESS" / "CP, AI (M11)" -> "Actors and access" / "CP, AI"
function sectionTitle(raw: string): string {
  const cleaned = raw
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+-\s+.*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
  const words = cleaned.split(' ').map((word) => {
    const bare = word.replace(/[^A-Za-z]/g, '')
    return bare.length >= 2 && bare.length <= 3 && bare === bare.toUpperCase() && !SMALL_WORDS.has(bare) ? word : word.toLowerCase()
  })
  const text = words.join(' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// "legacyName" -> "Legacy name"
function humanize(name: string): string {
  const spaced = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export function planTurtleOntologyImport(turtle: string): OntologyImportPlan {
  let store: Store
  try {
    store = new Store(new Parser().parse(turtle))
  } catch (err) {
    throw new OntologyImportError(`This doesn't parse as Turtle: ${err instanceof Error ? err.message : String(err)}`)
  }

  const objectsOf = (s: Quad_Subject, p: string) => store.getObjects(s, namedNode(p), null)
  const literals = (s: Quad_Subject, p: string) => objectsOf(s, p).filter((o): o is Extract<Quad_Object, { termType: 'Literal' }> => o.termType === 'Literal')
  // English first, then untagged, then anything.
  const bestLiteral = (s: Quad_Subject, p: string): string | undefined => {
    const all = literals(s, p)
    return (all.find((l) => l.language === 'en') ?? all.find((l) => !l.language) ?? all[0])?.value
  }

  const classNodes = [
    ...store.getSubjects(namedNode(RDF + 'type'), namedNode(OWL + 'Class'), null),
    ...store.getSubjects(namedNode(RDF + 'type'), namedNode(RDFS + 'Class'), null),
  ].filter((s) => s.termType === 'NamedNode' && !isStandard(s.value))
  const classIris = [...new Set(classNodes.map((c) => c.value))]
  const classSet = new Set(classIris)

  const propertyCount = new Set(
    [OWL + 'ObjectProperty', OWL + 'DatatypeProperty', RDF + 'Property'].flatMap((t) =>
      store.getSubjects(namedNode(RDF + 'type'), namedNode(t), null).map((s) => s.value)
    )
  ).size
  const shapeCount = store.getSubjects(namedNode(RDF + 'type'), namedNode(SH + 'NodeShape'), null).length

  if (classIris.length === 0) {
    throw new OntologyImportError(
      shapeCount > 0
        ? `No classes found -- this looks like a SHACL shapes file (${shapeCount} shapes), which validates data against an ontology rather than defining one. Attach the ontology file itself.`
        : 'No classes (owl:Class or rdfs:Class) found in this file, so there is nothing to put on the Ontology Map.'
    )
  }

  // Annotation properties the file declares itself (e.g. a requirement ID)
  // are worth carrying into descriptions; label them by their own label.
  const annotationProps = store
    .getSubjects(namedNode(RDF + 'type'), namedNode(OWL + 'AnnotationProperty'), null)
    .filter((s) => !isStandard(s.value))
    .map((s) => ({ iri: s.value, label: bestLiteral(s, RDFS + 'label') ?? humanize(localName(s.value)) }))

  const labelOf = (iri: string) => bestLiteral(namedNode(iri), RDFS + 'label') ?? bestLiteral(namedNode(iri), SKOS + 'prefLabel') ?? localName(iri)

  // Numbered section headers, and which one each class is declared under.
  const sections: { n: string; title: string }[] = []
  const sectionByLocalName = new Map<string, string>()
  let currentSection: string | null = null
  for (const line of turtle.split('\n')) {
    const header = line.match(/^#+\s*(\d+)[.)]\s+(\S.*)$/)
    if (header) {
      currentSection = header[1]
      sections.push({ n: header[1], title: sectionTitle(header[2]) })
      continue
    }
    const declared = line.match(/^\s*(?:[\w-]*:)?([\w-]+)\s+a\s+[^;.]*\b(?:owl:Class|rdfs:Class)\b/)
    if (declared && currentSection && !sectionByLocalName.has(declared[1])) sectionByLocalName.set(declared[1], currentSection)
  }

  const items: OntologyImportItem[] = []
  const usedSections = new Set<string>()
  for (const iri of classIris) {
    const node = namedNode(iri)
    const supers = objectsOf(node, RDFS + 'subClassOf')
      .filter((o) => o.termType === 'NamedNode' && classSet.has(o.value) && o.value !== iri)
      .map((o) => o.value)
    const section = sectionByLocalName.get(localName(iri))
    let parentTempId: string | null = supers[0] ?? null
    if (!parentTempId && section) {
      parentTempId = `section:${section}`
      usedSections.add(section)
    }

    const parts: string[] = []
    const comment = bestLiteral(node, RDFS + 'comment') ?? bestLiteral(node, SKOS + 'definition')
    if (comment) parts.push(comment)
    if (supers.length > 1) parts.push(`Also a kind of: ${supers.slice(1).map(labelOf).join(', ')}.`)
    for (const prop of annotationProps) {
      const values = literals(node, prop.iri).map((l) => l.value)
      if (values.length > 0) parts.push(`${prop.label.charAt(0).toUpperCase()}${prop.label.slice(1)}: ${values.join(', ')}.`)
    }
    const otherLabels = [...literals(node, SKOS + 'prefLabel'), ...literals(node, RDFS + 'label')].filter((l) => l.language && l.language !== 'en')
    if (otherLabels.length > 0) parts.push(`Other labels: ${otherLabels.map((l) => `${l.value} (${l.language})`).join(', ')}.`)
    const individuals = store
      .getSubjects(namedNode(RDF + 'type'), node, null)
      .filter((s) => s.termType === 'NamedNode')
      .map((s) => labelOf(s.value))
    if (individuals.length > 0) {
      const listed = individuals.slice(0, MAX_VALUES_LISTED).join(', ')
      parts.push(`Values: ${listed}${individuals.length > MAX_VALUES_LISTED ? `, … (${individuals.length} in all)` : ''}.`)
    }
    parts.push(`Source: ${localName(iri)}`)

    items.push({ tempId: iri, parentTempId, name: labelOf(iri), description: parts.join(' ') })
  }

  breakCycles(items)

  const groups: OntologyImportItem[] = sections
    .filter((s) => usedSections.has(s.n))
    .map((s) => ({
      tempId: `section:${s.n}`,
      parentTempId: null,
      name: s.title,
      description: `Section ${s.n} of the imported ontology file -- a grouping, not a class itself.`,
    }))

  const all = [...groups, ...items]
  if (all.length > MAX_IMPORT_OBJECTS) {
    throw new OntologyImportError(`This ontology has ${all.length} classes and groups -- more than the ${MAX_IMPORT_OBJECTS} the Ontology Map can import at once.`)
  }
  return { items: all, classCount: items.length, groupCount: groups.length, propertyCount, shapeCount }
}

// rdfs:subClassOf can legitimately loop (A ⊑ B ⊑ A means equivalent); the
// map needs a tree, so the edge that closes a loop is dropped.
function breakCycles(items: OntologyImportItem[]) {
  const byId = new Map(items.map((i) => [i.tempId, i]))
  for (const item of items) {
    const seen = new Set<string>([item.tempId])
    let cursor = item.parentTempId ? byId.get(item.parentTempId) : undefined
    while (cursor) {
      if (seen.has(cursor.tempId)) {
        item.parentTempId = null
        break
      }
      seen.add(cursor.tempId)
      cursor = cursor.parentTempId ? byId.get(cursor.parentTempId) : undefined
    }
  }
}

// Indented outline for the preview Ember shows before importing; long trees
// are cut off with a count of what's not shown.
export function outlineOntologyPlan(items: Pick<OntologyImportItem, 'tempId' | 'parentTempId' | 'name'>[], maxLines = 120): string {
  const children = new Map<string | null, typeof items>()
  const ids = new Set(items.map((i) => i.tempId))
  for (const item of items) {
    const key = item.parentTempId && ids.has(item.parentTempId) ? item.parentTempId : null
    if (!children.has(key)) children.set(key, [])
    children.get(key)!.push(item)
  }
  const lines: string[] = []
  const walk = (parent: string | null, depth: number) => {
    for (const item of children.get(parent) ?? []) {
      lines.push(`${'  '.repeat(depth)}- ${item.name}`)
      walk(item.tempId, depth + 1)
    }
  }
  walk(null, 0)
  if (lines.length <= maxLines) return lines.join('\n')
  return `${lines.slice(0, maxLines).join('\n')}\n… and ${lines.length - maxLines} more`
}
