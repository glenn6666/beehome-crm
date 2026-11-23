const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {data,lines}=require('./quote-fixture.cjs');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
const source=html.match(/<script>([\s\S]*)<\/script>/)[1].replace(/boot\(\);\s*$/,'');
new vm.Script(source);
const elements=new Map();
function element(){return {value:'',textContent:'',innerHTML:'',style:{},dataset:{},disabled:false,classList:{toggle(){}},querySelectorAll(){return []},appendChild(){}}}
const ctx={console,setTimeout(){},window:{scrollTo(){}},document:{querySelector(s){if(!elements.has(s))elements.set(s,element());return elements.get(s)},querySelectorAll(){return []},getElementById(){return element()},createElement:element},localStorage:{getItem(){return ''}},alert(m){ctx.alerts.push(m)},confirm(){return true},alerts:[]};
vm.createContext(ctx);vm.runInContext(source,ctx);
const clone=x=>JSON.parse(JSON.stringify(x));
let serverData=clone(data),serverLines=clone(lines),saved=[];
ctx.D=clone(data);ctx.S={view:'case',caseId:'DEMO-K'};
ctx.api=async function(fn,...args){
 if(fn==='getAll')return clone(serverData);
 if(fn==='getQuoteLines')return clone(serverLines);
 if(fn==='saveQuote'){saved.push(clone(args));serverLines=clone(args[1]);return {quoteId:'DEMO-Q2'}}
 throw Error('Unexpected API '+fn);
};
ctx.load=async function(){};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
 await ctx.openEditor('DEMO-Q1','木作工程');
 assert.equal(ctx.S.lines.length,2);assert(ctx.S.lines.every(l=>l.cat==='木作工程'));
 assert(!elements.get('#app').innerHTML.includes('工程類別</th>'));
 ctx.pick(0,'共用名稱');assert.equal(ctx.S.lines[0].price,1200,'same-name item must match this trade');
 ctx.S.lines[0].price=2200;
 // A different trade changes while the editor is open; merge its newest values.
 serverLines[1]['備註']='其他人更新的水電備註';serverLines[1]['報價單價']=1500;
 serverData.quotes.push({...data.quotes[0],'報價ID':'DEMO-Q2','版本':2});
 ctx.saveQ();ctx.saveQ();await settle();await settle();
 assert.equal(saved.length,1,'double-click must not create two versions');
 assert.deepEqual(saved[0][1].filter(l=>l['工程類別']==='水電工程'),serverLines.filter(l=>l['工程類別']==='水電工程'));
 assert.equal(saved[0][1].filter(l=>l['工程類別']==='木作工程')[0]['報價單價'],2200);
 assert.equal(saved[0][3],'草稿');assert(saved[0][2].startsWith('【木作工程】'));
 // Same-trade conflicts must not write.
 ctx.S.view='case';ctx.S.quoteCache={};await ctx.openEditor('DEMO-Q2','木作工程');
 serverLines.find(l=>l['工程類別']==='木作工程')['報價單價']=3300;
 ctx.saveQ();await settle();await settle();assert.equal(saved.length,1);assert(ctx.alerts.some(m=>m.includes('已有其他修改')));
 assert.equal(ctx.S.view,'editor');assert.equal(ctx.S.savingQuote,false);
 // Invalid values must not reach the save endpoint.
 ctx.S.lines[0].qty=-1;ctx.saveQ();assert.equal(saved.length,1);assert(ctx.alerts.at(-1).includes('有效的數量'));
 // Category print includes only selected rows and costs never appear in customer view.
 ctx.D=clone(serverData);
 await ctx.openPrint('DEMO-Q2','水電工程');assert.equal(ctx.S.pl.length,1);
 ctx.vPrint();let printed=elements.get('#app').innerHTML;
 assert(printed.includes('水電工程報價單'));assert(printed.includes('插座配線'));assert(!printed.includes('收納櫃'));assert(!printed.includes('成本價'));
 // Spreadsheet account settings may arrive as a number, not text. Both saved
 // and unsaved previews must render without calling string methods on numbers.
 ctx.D.settings['匯款帳戶']=1234567890;ctx.vPrint();assert(elements.get('#app').innerHTML.includes('交易匯款帳戶：1234567890'));
 ctx.D.settings['匯款帳戶']='001234567890';ctx.vPrint();assert(elements.get('#app').innerHTML.includes('交易匯款帳戶：001234567890'));
 ctx.D.settings['匯款帳戶']='請自行填寫';ctx.vPrint();assert(!elements.get('#app').innerHTML.includes('交易匯款帳戶：'));
 ctx.D.settings['匯款帳戶']=null;ctx.vPrint();assert(!elements.get('#app').innerHTML.includes('交易匯款帳戶：'));
 ctx.D.settings['匯款帳戶']=1234567890;
 await ctx.openPrint('DEMO-Q2');ctx.vPrint();printed=elements.get('#app').innerHTML;
 assert(printed.includes('水電工程'));assert(printed.includes('木作工程'));assert.equal(ctx.S.printTrade,'');
 // Legacy/custom and zero-price trades remain printable.
 ctx.S.pl=[{'工程類別':'自訂工程','項目':'免費項目','換算數量':1,'報價單價':0,'小計':0}];ctx.vPrint();assert(elements.get('#app').innerHTML.includes('自訂工程'));
 // Failed network writes leave the editor available for retry.
 ctx.S.view='case';ctx.S.quoteCache={};await ctx.openEditor('DEMO-Q2','水電工程');
 // Preview uses unsaved editor rows without another API request; the fee switch
 // changes totals and hides the fee row, while retaining drafts on return.
 ctx.S.lines[0].price=2000;elements.get('#qnote').value='保留未儲存說明';
 const previewApi=ctx.api;ctx.api=()=>{throw Error('Preview must not call the API')};
 ctx.previewTrade();assert.equal(ctx.S.view,'print');assert.equal(ctx.S.printOrigin,'editor');
 printed=elements.get('#app').innerHTML;assert(printed.includes('水電工程報價單'));assert(printed.includes('6,300'));assert(printed.includes('設計及監工費用5%'));
 assert(!printed.includes('成本價'));assert(!printed.includes('毛利'));
 ctx.togglePrintFee();printed=elements.get('#app').innerHTML;assert(printed.includes('6,000'));assert(!printed.includes('設計及監工費用5%'));assert(printed.includes('不加收設計監工費'));
 ctx.returnQuotePreview();assert.equal(ctx.S.view,'editor');assert.equal(ctx.S.lines[0].price,2000);assert.equal(ctx.S.editorNote,'保留未儲存說明');
 ctx.previewTrade();assert.equal(ctx.S.printWithFee,false);ctx.togglePrintFee();assert.equal(ctx.S.printWithFee,true);
 ctx.returnQuotePreview();ctx.api=previewApi;
 const realApi=ctx.api;ctx.api=async function(fn,...args){if(fn==='saveQuote')throw Error('network');return realApi(fn,...args)};
 ctx.saveQ();await settle();await settle();assert.equal(ctx.S.view,'editor');assert.equal(ctx.S.savingQuote,false);assert.equal(elements.get('#saveQuoteBtn').disabled,false);
 console.log('PASS: trade isolation, latest merge, pricing, conflict/duplicate guards, validation, single/all/custom printing, unsaved preview without API calls, 5% fee toggle and totals, preserved draft/note, retry after failure');
})().catch(e=>{console.error(e);process.exitCode=1});
