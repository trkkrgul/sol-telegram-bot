import meCommand from './me.js';
import createCommand from './create.js';
import campaignsCommand from './campaigns.js';

export function registerCommands(bot) {
  meCommand(bot);
  createCommand(bot);
  campaignsCommand(bot);
}
