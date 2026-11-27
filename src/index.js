'use strict';
const {loadConfig}=require('./config');
const {createPool}=require('./database/pool');
const {CodeAllocationService}=require('./services/code-allocation');
const {CategoryRepository}=require('./services/category-repository');
const {GroupRateLimiter}=require('./services/group-rate-limiter');
const {AdminRepository}=require('./services/admin-repository');
const {CalculationRepository}=require('./services/calculation-repository');
const {createMessageHandler}=require('./commands/message-handler');
const {createWhatsAppBot}=require('./bot/client');
const {createApp}=require('./app');
const logger=require('./utilities/logger');
// whatsapp-web.js registers raw page.on('framenavigated', async ...) handlers
// internally; an evaluate() call racing a rapid double-navigation (e.g. during
// logout) can reject with "Execution context was destroyed" with nothing of
// ours in the call chain to catch it, which Node treats as fatal by default.
// Log and keep running instead of losing the whole process (and its in-memory
// rate limiter / in-flight dedup state) over a bug in that dependency — our
// own 'disconnected' handler already triggers a clean reconnect for this.
process.on('unhandledRejection',(reason)=>{logger.error('Unhandled promise rejection',{error:reason});});
process.on('uncaughtException',(error)=>{logger.error('Uncaught exception',{error});});
async function main(){
 const config=loadConfig();const pool=createPool(config.databaseUrl);await pool.query('SELECT 1');
 const botState={ready:false,authenticated:false};
 const allocationService=new CodeAllocationService(pool);
 const categoryRepository=new CategoryRepository(pool);
 const adminRepository=new AdminRepository(pool);
 const calculationRepository=new CalculationRepository(pool);
 if (config.adminNumbers) await adminRepository.seedFromCsv(config.adminNumbers);
 const rateLimiter=new GroupRateLimiter({limit:config.groupRateLimit,windowMs:config.groupRateWindowMinutes*60*1000});
 const messageHandler=createMessageHandler({allocationService,categoryRepository,pool,isAdmin:adminRepository.isAllowed.bind(adminRepository),rateLimiter,maxCodesPerRequest:config.maxCodesPerRequest,tagDelayMinSeconds:config.tagResponseDelayMinSeconds,tagDelayMaxSeconds:config.tagResponseDelayMaxSeconds,lowStockAlertGroupId:config.lowStockAlertGroupId,logger});
 const bot=createWhatsAppBot({clientId:config.whatsappClientId,messageHandler,state:botState,logger,reconnectDelayMs:config.reconnectDelayMs,calculateAdminGroupId:config.calculateAdminGroupId,calculationRepository,isAdmin:adminRepository.isAllowed.bind(adminRepository),currencyBroadcastGroupId:config.currencyBroadcastGroupId,broadcastDelayMinSeconds:config.broadcastDelayMinSeconds,broadcastDelayMaxSeconds:config.broadcastDelayMaxSeconds});
 const app=createApp({pool,config,botState});const server=app.listen(config.port,()=>logger.info('HTTP server listening',{port:config.port}));
 await bot.initialize();
 let shuttingDown=false;async function shutdown(signal){if(shuttingDown)return;shuttingDown=true;logger.info('Graceful shutdown started',{signal});await new Promise(resolve=>server.close(resolve));await bot.stop();await pool.end();logger.info('Graceful shutdown complete');}
 function requestShutdown(signal){shutdown(signal).catch(error=>{logger.error('Graceful shutdown failed',{error});process.exitCode=1;});}
 process.once('SIGINT',()=>requestShutdown('SIGINT'));process.once('SIGTERM',()=>requestShutdown('SIGTERM'));
}
if(require.main===module)main().catch(error=>{logger.error('Application startup failed',{error});process.exitCode=1;});
module.exports={main};
