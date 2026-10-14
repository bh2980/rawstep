import type {Case} from '../cases.js';

/** New questions and a separate transfer cohort; page titles never reveal the condition. */
export function generateArticleFollowup(partition:'train'|'test'){
  const pages:Record<string,string>={},cases:Case[]=[];
  const setId=partition==='train'?'article-followup-v2':'article-transfer-v2';
  const image='<img alt="Bay at sunrise" width="40" height="30" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2230%22%3E%3Crect width=%2240%22 height=%2230%22 fill=%22navy%22/%3E%3C/svg%3E">';
  const walk=(n:number)=>[...Array.from({length:n},()=>'VO+Right'),'VO+Left'];
  const add=(id:string,family:string,body:string,chords:string[])=>{
    pages[id]=`<!doctype html><html lang="en"><meta charset="utf-8"><title>Coastal reading experiment</title><style>body{font:18px system-ui;padding:20px}button,a{margin:8px}</style><body><button id="before" autofocus>Before marker</button>${body}<button id="after">After marker</button></body></html>`;
    cases.push({id:`${setId}.${id}`,page:`pages/${id}.html`,chords,captureAxAfterSteps:true,axes:{family,role:'article-question',command:'navigation',partition,exposure:partition==='train'?'calibration':'unseen',templateGroup:`${setId}.${id}`,reference:'reduced-live-page-question'}});
  };
  if(partition==='train'){
    add('two-links','heading-parts','<h2><a href="#one">Timetable</a> and <a href="#two">Fares</a></h2>',walk(5));
    add('link-tail','heading-parts','<h2><a href="#one">Timetable</a> overview</h2>',walk(4));
    add('inline-heading','heading-parts','<h2><span>Harbor</span><em> services</em></h2>',walk(3));
    add('heading-label','heading-parts','<h2 aria-label="Journey planner"><a href="#one">Harbor information</a></h2>',walk(4));
    add('partial-tab','heading-focus','<h2>Harbor <a href="#one">services</a></h2>',['VO+Right','Tab','Shift+Tab','VO+Right','Tab']);
    add('full-tab','heading-focus','<h2><a href="#one">Harbor services</a></h2>',['VO+Right','Tab','Shift+Tab','VO+Right']);
    add('no-heading','article','<article><p>Harbor report.</p><button>Read more</button></article>',walk(6));
    add('nested','article','<article><h2>Outer notes</h2><article><h3>Inner notes</h3><p>Ferry news.</p></article><p>Outer ending.</p></article>',walk(12));
    add('header-footer','article','<article><header><h2><a href="#one">Harbor report</a></h2><p>Filed today</p></header><p>Ferries are running.</p><footer><a href="#comments">Comments</a></footer></article>',walk(11));
    add('named-figure','figure',`<figure aria-label="Bay photograph">${image}<figcaption>Early crossings</figcaption></figure>`,walk(5));
    add('time','time','<time datetime="2026-11-04">November 4, 2026</time><span>November 4, 2026</span>',walk(4));
    add('punctuation','text','<p>By <a href="#author">Nora</a>.</p><p>With <a href="#editor">Eli</a>, continued.</p>',walk(8));
  }else{
    add('news-shell','article-transfer','<main><article aria-label="Museum reopening"><header><h3><a href="#story">Museum opens on Friday</a></h3></header><p>Local news <a href="#source">Source</a>.</p></article></main>',walk(13));
    add('product-card','article-transfer',`<section><article><h3><a href="#item"><span>Canvas</span> travel bag</a></h3><figure>${image}</figure><p>Available in blue.</p></article></section>`,walk(11));
    add('outer-link-wrapper','heading-transfer','<nav aria-label="Walking routes"><a href="#route"><div><h3>River trail</h3></div></a></nav><main><p>Follow the riverside path.</p><button>Trail conditions</button></main>',['VO+Cmd+H','VO+Right','VO+Left','VO+Right','VO+Right','VO+Right']);
    add('navigation-heading','heading-transfer','<nav aria-label="Visitor information"><h2>Explore <a href="#guide">the island</a></h2><p>Plan a visit.</p></nav>',walk(8));
    add('labelled-news','article-transfer','<article aria-labelledby="story-title"><header><h4 id="story-title"><a href="#story">Library renovation</a></h4></header><p>Construction starts soon.</p><time datetime="2027-02-02">February 2, 2027</time></article>',walk(9));
    add('table-heading','heading-transfer','<table><caption>Guide index</caption><tr><th>Route</th><th>Notes</th></tr><tr><td><h3><a href="#schedule">Departures</a></h3></td><td>Weekday timetable</td></tr></table>',walk(12));
    add('figure-story','article-transfer',`<article><figure>${image}<figcaption>Morning deliveries</figcaption></figure><h3><a href="#story">A day at the docks</a></h3><p>Daily dispatch.</p></article>`,walk(10));
    add('anchor-journey','activation-transfer','<main><article><h3><a href="#tail">Accessibility statement</a></h3><p>Opening summary.</p><section id="tail" tabindex="-1" aria-label="Access support"><h4>Contact the access team</h4><button>Request assistance</button></section></article></main>',['VO+Cmd+H','VO+Space','VO+Right','VO+Left']);
  }
  return {pages,cases};
}
