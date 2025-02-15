export const isAdmin = async (ctx, next) => {
  try {
    // Admin grubu için kontrol
    const admins = await ctx.getChatAdministrators();
    console.log('Admins:', admins);
    const isUserAdmin = admins.some((admin) => admin.user.id === ctx.from.id);

    if (isUserAdmin) {
      return next();
    }

    // Admin değilse
    await ctx.reply('You need to be an admin to use this command.');
  } catch (error) {
    console.error('Error checking admin status:', error);
    await ctx.reply('An error occurred while checking permissions.');
  }
};
