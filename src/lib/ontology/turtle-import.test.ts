import { describe, expect, it } from 'vitest'
import { OntologyImportError, outlineOntologyPlan, planTurtleOntologyImport } from './turtle-import'

const TTL = `@prefix ex:   <https://example.org/fleet#> .
@prefix owl:  <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .

ex:ticket a owl:AnnotationProperty ; rdfs:label "ticket"@en .
ex:legacyName a owl:AnnotationProperty .

# =====================================================
# 1. ASSETS (physical)
# =====================================================
ex:Asset a owl:Class ; rdfs:label "Asset"@en .
ex:Vehicle a owl:Class ; rdfs:subClassOf ex:Asset, ex:Insurable ; rdfs:label "Vehicle"@en ;
    rdfs:comment "Anything that moves under its own power."@en ; ex:ticket "FL-12" ; skos:prefLabel "Sasakyan"@tl .
ex:Insurable a owl:Class ; rdfs:label "Insurable thing"@en .

# 2. OPERATIONS AND AI - daily running
ex:Route a owl:Class ; rdfs:label "Route"@en ; ex:legacyName "Line" .
ex:Status a owl:Class ; rdfs:label "Status"@en .
ex:st_active a ex:Status ; rdfs:label "active"@en .
ex:st_retired a ex:Status ; rdfs:label "retired"@en .
ex:serves a owl:ObjectProperty ; rdfs:domain ex:Vehicle ; rdfs:range ex:Route .
`

describe('planTurtleOntologyImport', () => {
  const plan = planTurtleOntologyImport(TTL)
  const byName = (name: string) => plan.items.find((i) => i.name === name)!

  it('turns classes into objects and groups parentless ones by numbered section', () => {
    expect(plan.classCount).toBe(5)
    expect(plan.groupCount).toBe(2)
    expect(plan.propertyCount).toBe(1)
    expect(byName('Assets').parentTempId).toBeNull()
    expect(byName('Operations and AI').parentTempId).toBeNull()
    expect(byName('Asset').parentTempId).toBe('section:1')
    expect(byName('Route').parentTempId).toBe('section:2')
    expect(byName('Route').description).toContain('Legacy name: Line.')
  })

  it('uses the first superclass as the parent and notes the rest', () => {
    const vehicle = byName('Vehicle')
    expect(vehicle.parentTempId).toBe('https://example.org/fleet#Asset')
    expect(vehicle.description).toContain('Anything that moves under its own power.')
    expect(vehicle.description).toContain('Also a kind of: Insurable thing.')
    expect(vehicle.description).toContain('Ticket: FL-12.')
    expect(vehicle.description).toContain('Other labels: Sasakyan (tl).')
    expect(vehicle.description).toContain('Source: Vehicle')
  })

  it('lists individuals as values instead of making them objects', () => {
    expect(plan.items.some((i) => i.name === 'active')).toBe(false)
    expect(byName('Status').description).toContain('Values: active, retired.')
  })

  it('outlines the tree for the preview', () => {
    expect(outlineOntologyPlan(plan.items)).toBe(
      ['- Assets', '  - Asset', '    - Vehicle', '  - Insurable thing', '- Operations and AI', '  - Route', '  - Status'].join('\n')
    )
    expect(outlineOntologyPlan(plan.items, 2)).toBe('- Assets\n  - Asset\n… and 5 more')
  })

  it('breaks a subclass loop instead of failing', () => {
    const looped = planTurtleOntologyImport(`@prefix ex: <https://example.org/x#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
ex:A a owl:Class ; rdfs:subClassOf ex:B .
ex:B a owl:Class ; rdfs:subClassOf ex:A .`)
    expect(looped.items.filter((i) => i.parentTempId === null)).toHaveLength(1)
  })

  it('explains a SHACL shapes file, and rejects unparseable text', () => {
    const shapes = `@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix ex: <https://example.org/x#> .
ex:ThingShape a sh:NodeShape ; sh:targetClass ex:Thing .`
    expect(() => planTurtleOntologyImport(shapes)).toThrow(/SHACL shapes file/)
    expect(() => planTurtleOntologyImport('this is not turtle {')).toThrow(OntologyImportError)
  })
})
