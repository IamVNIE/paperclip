const { db } = require('@paperclipai/db');
const { eq } = require('drizzle-orm');
const { authUsers, authAccounts } = require('@paperclipai/db');

(async () => {
  const users = await db.select().from(authUsers).where(eq(authUsers.email, 'vinayaka@snowmountain.ai'));
  console.log('users found:', users.length, users[0]?.id);

  if (!users[0]) {
    console.log('No user found - account may be missing entirely');
    return;
  }

  const accounts = await db.select().from(authAccounts).where(eq(authAccounts.userId, users[0].id));
  console.log('accounts found:', accounts.length);
  accounts.forEach(a => console.log('  provider:', a.providerId, 'hasPassword:', !!a.password));
})();
