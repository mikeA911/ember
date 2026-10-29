// Sets an existing account's password from the terminal, for when the
// password reset email doesn't arrive (for example Supabase's built-in
// email limits). The password is typed hidden and never printed or logged.
//
//   node --env-file=.env.local scripts/set-user-password.mjs you@example.com
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')

const email = process.argv[2]
if (!email) throw new Error('Usage: node --env-file=.env.local scripts/set-user-password.mjs <email>')

function askHidden(prompt) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin
    if (!stdin.isTTY) return reject(new Error('Run this in a terminal so the password can be typed hidden.'))
    process.stdout.write(prompt)
    let value = ''
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    const onData = (ch) => {
      if (ch === '\r' || ch === '\n' || ch === '\u0004') {
        stdin.setRawMode(false)
        stdin.pause()
        stdin.off('data', onData)
        process.stdout.write('\n')
        resolve(value)
      } else if (ch === '\u0003') {
        stdin.setRawMode(false)
        process.stdout.write('\n')
        process.exit(130)
      } else if (ch === '\u007f' || ch === '\b') {
        value = value.slice(0, -1)
      } else {
        value += ch
      }
    }
    stdin.on('data', onData)
  })
}

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

let user = null
for (let page = 1; !user; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
  if (error) throw error
  user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null
  if (data.users.length < 200) break
}
if (!user) throw new Error(`No account for ${email}. Create it first (scripts/create-mike-admin.mjs).`)

const password = await askHidden('New password (at least 12 characters): ')
if (password.length < 12) throw new Error('Use at least 12 characters.')
const again = await askHidden('Type it again: ')
if (again !== password) throw new Error('The two entries differ. Nothing changed.')

const { error } = await admin.auth.admin.updateUserById(user.id, { password, email_confirm: true })
if (error) throw error
console.log(`Password set for ${email}. Sign in on the site with it.`)
