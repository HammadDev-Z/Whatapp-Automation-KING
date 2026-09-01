'use strict';
const {loadConfig}=require('./config');
const {createPool}=require('./database/pool');
const {CodeAllocationService}=require('./services/code-allocation');
const {CategoryRepository}=require('./services/category-repository');
const {GroupRateLimiter}=require('./services/group-rate-limiter');
const {AdminRepository}=require('./services/admin-repository');
const {createMessageHandler}=require('./commands/message-handler');
const {createWhatsAppBot}=require('./bot/client');
const {createApp}=require('./app');
const logger=require('./utilities/logger');
async function main(){
 const config=loadConfig();const pool=createPool(config.databaseUrl);await pool.query('SELECT 1');
 const botState={ready:false,authenticated:false};
 const allocationService=new CodeAllocationService(pool);
 const categoryRepository=new CategoryRepository(pool);
 const adminRepository=new AdminRepository(pool);
 if (config.adminNumbers) await adminRepository.seedFromCsv(config.adminNumbers);
 const rateLimiter=new GroupRateLimiter({limit:config.groupRateLimit,windowMs:config.groupRateWindowMinutes*60*1000});
 const messageHandler=createMessageHandler({allocationService,categoryRepository,pool,isAdmin:adminRepository.isAllowed.bind(adminRepository),rateLimiter,maxCodesPerRequest:config.maxCodesPerRequest,tagDelayMinSeconds:config.tagResponseDelayMinSeconds,tagDelayMaxSeconds:config.tagResponseDelayMaxSeconds,logger});
 const bot=createWhatsAppBot({clientId:config.whatsappClientId,messageHandler,state:botState,logger,reconnectDelayMs:config.reconnectDelayMs,calculateAdminGroupId:config.calculateAdminGroupId});
 const app=createApp({pool,config,botState});const server=app.listen(config.port,()=>logger.info('HTTP server listening',{port:config.port}));
 await bot.initialize();
 let shuttingDown=false;async function shutdown(signal){if(shuttingDown)return;shuttingDown=true;logger.info('Graceful shutdown started',{signal});await new Promise(resolve=>server.close(resolve));await bot.stop();await pool.end();logger.info('Graceful shutdown complete');}
 function requestShutdown(signal){shutdown(signal).catch(error=>{logger.error('Graceful shutdown failed',{error});process.exitCode=1;});}
 process.once('SIGINT',()=>requestShutdown('SIGINT'));process.once('SIGTERM',()=>requestShutdown('SIGTERM'));
}
if(require.main===module)main().catch(error=>{logger.error('Application startup failed',{error});process.exitCode=1;});
module.exports={main};
