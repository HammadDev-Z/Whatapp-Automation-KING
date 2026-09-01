'use strict';
const path=require('node:path');
const qrcode=require('qrcode-terminal');
const {Client,LocalAuth}=require('whatsapp-web.js');
const {createCalculationHandler}=require('../commands/calculation-handler');
function createWhatsAppBot({clientId,messageHandler,state,logger,reconnectDelayMs}){
 const client=new Client({authStrategy:new LocalAuth({clientId,dataPath:path.join(process.cwd(),'.wwebjs_auth')}),puppeteer:{headless:true,executablePath:process.env.PUPPETEER_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-setuid-sandbox']}});
 let reconnectTimer=null;let initializing=false;let stopping=false;
 async function initialize(){if(initializing||stopping)return;initializing=true;try{await client.initialize();}catch(error){logger.error('WhatsApp initialization failed',{error});scheduleReconnect();}finally{initializing=false;}}
 function scheduleReconnect(){if(stopping||reconnectTimer)return;reconnectTimer=setTimeout(()=>{reconnectTimer=null;initialize();},reconnectDelayMs);}
 client.on('qr',qr=>{logger.info('WhatsApp QR code received');qrcode.generate(qr,{small:true});});
 client.on('authenticated',()=>{state.authenticated=true;logger.info('WhatsApp authenticated');});
 client.on('ready',()=>{state.ready=true;state.authenticated=true;logger.info('WhatsApp client ready');});
 client.on('auth_failure',message=>{state.ready=false;state.authenticated=false;logger.error('WhatsApp authentication failure',{reason:String(message).slice(0,300)});scheduleReconnect();});
 client.on('disconnected',reason=>{state.ready=false;state.authenticated=false;logger.warn('WhatsApp disconnected',{reason:String(reason).slice(0,300)});scheduleReconnect();});
 client.on('message',messageHandler);
 client.on('message',createCalculationHandler({logger}));
 return {client,initialize,async stop(){stopping=true;if(reconnectTimer)clearTimeout(reconnectTimer);try{await client.destroy();}catch(error){logger.warn('WhatsApp shutdown error',{error});}}};
}
module.exports={createWhatsAppBot};
