import type {Case} from '../cases.js';

/** Role, enclosing context and revisit contrasts; transfer pages compose different input structures. */
export function generateHints(partition:'train'|'test'){
  const pages:Record<string,string>={},cases:Case[]=[],setId=partition==='train'?'hints-v1':'hints-transfer-v1';
  const walk=(n:number)=>[...Array.from({length:n},()=>'VO+Right'),'VO+Left','VO+Right'];
  const add=(id:string,role:string,body:string,chords:string[],context='web')=>{
    pages[id]=`<!doctype html><html lang="en"><meta charset="utf-8"><title>Harbor interaction study</title><style>body{font:18px system-ui;padding:20px}button,a,input{margin:8px}</style><body><button id="before" autofocus>Before marker</button>${body}<button id="after">After marker</button></body></html>`;
    cases.push({id:`${setId}.${id}`,page:`pages/${id}.html`,chords,captureAxAfterSteps:true,
      listen:{minWaitMs:1000,quietMs:800,maxWaitMs:6000},axes:{role,family:'usage-hints',context,partition,exposure:partition==='train'?'calibration':'unseen',templateGroup:`${setId}.${id}`,command:'navigation-and-state'}});
  };
  if(partition==='train'){
    add('buttons','button','<button>Save draft</button><button>Preview draft</button><button disabled>Unavailable</button>',walk(6));
    add('links','link','<a href="#one">Route guide</a><a href="#two">Ferry fares</a>',walk(4));
    add('headings','heading','<h2>Travel information</h2><h3><a href="#guide">Island guide</a></h3>',['VO+Right','VO+Cmd+H','VO+Left','VO+Right','VO+Right','VO+Right']);
    add('text','text','<p>Morning sailings.</p><p>Read <a href="#guide">the guide</a>.</p>',walk(7));
    add('checkbox','checkbox','<label><input type="checkbox">Send notices</label>',['Tab','Space','Space','VO+Right','VO+Left']);
    add('switch','switch','<button role="switch" aria-checked="false" onclick="this.setAttribute(\'aria-checked\',this.getAttribute(\'aria-checked\')!==\'true\')">Quiet mode</button>',['VO+Right','VO+Space','VO+Space','VO+Right','VO+Left']);
    add('toggle','button','<button aria-pressed="false" onclick="this.setAttribute(\'aria-pressed\',this.getAttribute(\'aria-pressed\')!==\'true\')">Favorite journey</button>',['Tab','Space','Space','VO+Right','VO+Left']);
    add('input','textbox','<label>Journey note<input autocomplete="off"></label>',['Tab','a','b','Left','VO+Right','VO+Left']);
    add('textarea','textbox','<label>Delivery notes<textarea></textarea></label>',['Tab','a','Left','VO+Right','VO+Left']);
    add('slider','slider','<label>Volume<input type="range" min="0" max="10" value="5"></label>',['Tab','Right','Left','VO+Right','VO+Left']);
    add('details','button','<details><summary>Ticket conditions</summary><p>Refunds before departure.</p></details>',['VO+Right','VO+Space','VO+Right','VO+Left','VO+Space','VO+Right']);
    add('list-text','list','<ul><li>Early crossing</li><li>Late crossing</li></ul>',walk(6));
    add('list-links','list','<ul><li><a href="#one">Early crossing</a></li><li><a href="#two">Late crossing</a></li></ul>',walk(8));
    add('groups','group','<div role="group" aria-label="Journey"><button>Pick date</button><div role="group" aria-label="Return"><p>Optional return.</p><button>Pick return</button></div></div>',walk(10),'nested-group');
    add('article','article','<article><h2>Port update</h2><p>New boarding gate.</p><button>Read update</button></article>',walk(7),'article');
    add('table','table','<table><caption>Sailings</caption><tr><th>Time</th><th>Action</th></tr><tr><td>Morning</td><td><button>Reserve seat</button></td></tr></table>',walk(9),'table');
    add('dialog','dialog','<button onclick="document.querySelector(\'dialog\').showModal()">Open preferences</button><dialog aria-label="Travel preferences"><h2>Choose preferences</h2><label><input type="checkbox">Send updates</label><button onclick="this.closest(\'dialog\').close()">Done</button></dialog>',['VO+Right','Enter','Tab','Space','Tab','Enter','VO+Right'],'dialog');
    add('radio','radio','<fieldset><legend>Crossing</legend><label><input type="radio" name="crossing" checked>Morning</label><label><input type="radio" name="crossing">Evening</label></fieldset>',['Tab','Right','Left','VO+Right','VO+Left'],'fieldset');
    add('navigation','navigation','<nav aria-label="Trip links"><h2>Plan</h2><a href="#one">Directions</a><button>Options</button></nav>',walk(7),'navigation');
    add('figure','figure','<figure aria-label="Port view"><img alt="Boats at sunrise" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E"><figcaption>Morning scene</figcaption></figure>',walk(6),'figure');
  }else{
    add('account-panel','group','<main><div role="group" aria-label="Account options"><h3>Notifications</h3><label><input type="checkbox">Email notices</label><button>Save choices</button></div></main>',walk(10),'main-group');
    add('story-list','article','<article aria-label="Weekend dispatch"><h3>Weekend news</h3><ol><li>Road changes</li><li>Harbor hours</li></ol><p>Updated today.</p></article>',walk(12),'article-list');
    add('navigation-actions','navigation','<nav aria-label="Museum visits"><h4><a href="#hours">Opening hours</a></h4><button>Book visit</button></nav><p>See you soon.</p>',walk(8),'navigation-heading');
    add('order-table','table','<main><table><caption>Order history</caption><tr><th>Order</th><th>Details</th></tr><tr><td>Summer parcel</td><td><button>Track parcel</button></td></tr></table></main>',walk(12),'main-table');
    add('help-dialog','dialog','<button onclick="document.querySelector(\'dialog\').showModal()">Contact support</button><dialog aria-label="Support request"><label>Question<input autocomplete="off"></label><button onclick="this.closest(\'dialog\').close()">Close request</button></dialog>',['VO+Right','VO+Space','Tab','Shift+Tab','VO+Right','Tab','Enter','VO+Right'],'dialog-form');
    add('shipping-disclosure','button','<main><h2>Shipping</h2><details><summary>International delivery</summary><p>Allow an extra week.</p><a href="#terms">Delivery terms</a></details></main>',['VO+Right','VO+Right','VO+Right','VO+Space','VO+Right','VO+Right','VO+Left','VO+Left','VO+Space','VO+Right'],'main-details');
    add('reservation-form','textbox','<form aria-label="Reserve a visit"><h3>Your visit</h3><label>Booking comment<input autocomplete="off"></label><button>Review booking</button></form>',['VO+Right','VO+Right','Tab','n','VO+Right','VO+Left','VO+Left'],'form');
    add('caption-article','figure','<article><h3>Market day</h3><figure aria-label="Market square"><img alt="Morning stalls" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E"><figcaption>Vendors arriving</figcaption></figure><p>Open until noon.</p></article>',walk(12),'article-figure');
  }
  return {pages,cases};
}
