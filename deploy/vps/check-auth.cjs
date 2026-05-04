const postgres = require('postgres');

const sql = postgres(process.env.DATABASE_URL, { ssl: 'require', max: 1 });

(async () => {
  const users = await sql`
    SELECT id, email, name FROM auth_users WHERE email = 'vinayaka@snowmountain.ai'
  `;
  console.log('users found:', users.length, users[0]?.id);

  if (!users[0]) {
    console.log('No user found');
    await sql.end();
    return;
  }

  const accounts = await sql`
    SELECT provider_id, password FROM auth_accounts WHERE user_id = ${users[0].id}
  `;
  console.log('accounts found:', accounts.length);
  accounts.forEach(a => console.log('  provider:', a.provider_id, 'hasPassword:', !!a.password));
  await sql.end();
})();
