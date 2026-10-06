// Operator diagnostic: confirms a user row exists and whether it has a
// credential (password) account. Reads the DB directly, so it needs
// DATABASE_URL and is never reachable over HTTP. Prints no hashes.
//
// Usage: DATABASE_URL=... node deploy/vps/check-auth.cjs user@example.com
const postgres = require('postgres');

const email = process.argv[2] || process.env.CHECK_AUTH_EMAIL;
if (!process.env.DATABASE_URL || !email) {
  console.error('Usage: DATABASE_URL=... node check-auth.cjs <email>');
  process.exit(2);
}

const sql = postgres(process.env.DATABASE_URL, { ssl: 'require', max: 1 });

(async () => {
  const users = await sql`
    SELECT id, email, name FROM "user" WHERE email = ${email}
  `;
  console.log('users found:', users.length, users[0]?.id);

  if (!users[0]) {
    console.log('No user found');
    await sql.end();
    return;
  }

  const accounts = await sql`
    SELECT provider_id, (password IS NOT NULL) AS has_password FROM "account" WHERE user_id = ${users[0].id}
  `;
  console.log('accounts found:', accounts.length);
  accounts.forEach(a => console.log('  provider:', a.provider_id, 'hasPassword:', a.has_password));
  await sql.end();
})().catch(async (err) => {
  console.error(err.message);
  await sql.end().catch(() => {});
  process.exit(1);
});
