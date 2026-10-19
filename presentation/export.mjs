import { chromium } from '@playwright/test';
import { resolve } from 'node:path';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1600,height:900},deviceScaleFactor:1});
await page.goto('file://'+resolve('presentation/bizroam-pitch.html'),{waitUntil:'networkidle'});
await page.evaluate(()=>document.fonts.ready);
const broken=await page.locator('img').evaluateAll(imgs=>imgs.filter(i=>!i.complete||!i.naturalWidth).map(i=>i.alt));
if(broken.length)throw new Error('Missing images '+JSON.stringify(broken));
await page.emulateMedia({media:'print'});
await page.pdf({path:'presentation/bizroam-pitch.pdf',width:'1600px',height:'900px',printBackground:true,preferCSSPageSize:true});
await page.emulateMedia({media:'screen'});
for(let i=1;i<=5;i++){await page.evaluate(i=>show(i-1),i);await page.screenshot({path:`presentation/assets/slide-${String(i).padStart(2,'0')}.png`});}
const overflow=await page.evaluate(()=>[...document.querySelectorAll('.slide')].map((s,i)=>({slide:i+1,width:s.scrollWidth,height:s.scrollHeight})).filter(s=>s.width>1600||s.height>900));
console.log(JSON.stringify({slides:5,imagesLoaded:true,overflow}));
await browser.close();
