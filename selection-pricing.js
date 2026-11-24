/* Shared catalogue and recommendation rules; server remains authoritative. */
(function(root){
"use strict";
const G = [
  {
    id: "giant_connect_4",
    name: "Giant Connect 4",
    tier: "premium",
    price: 125,
  },
  {
    id: "giant_noughts_and_crosses",
    name: "Giant Noughts & Crosses",
    tier: "premium",
    price: 125,
  },
  { id: "cornhole", name: "Cornhole", tier: "premium", price: 125 },
  { id: "giant_jenga", name: "Giant Jenga", tier: "classic", price: 50 },
  {
    id: "wooden_ring_toss",
    name: "Wooden Ring Toss",
    tier: "classic",
    price: 50,
  },
  { id: "giant_dominoes", name: "Giant Dominoes", tier: "classic", price: 50 },
  { id: "limbo", name: "Limbo", tier: "classic", price: 50 },
];
const P = [
  {
    id: "classic_collection",
    name: "Classic Collection",
    price: 200,
    p: 0,
    c: 4,
    desc: "All 4 Classic games.",
    kind: "LAID-BACK LAWN FAVOURITES",
  },
  {
    id: "the_mix",
    name: "The Mix",
    price: 325,
    p: 2,
    c: 2,
    desc: "Choose 2 Premium + 2 Classic games.",
    kind: "A LITTLE OF EVERYTHING",
  },
  {
    id: "premium_collection",
    name: "Premium Collection",
    price: 350,
    p: 3,
    c: 0,
    desc: "All 3 Premium games.",
    kind: "BIG GAMES. BIG COMPETITION.",
  },
  {
    id: "complete_collection",
    name: "Complete Collection",
    price: 475,
    p: 3,
    c: 4,
    desc: "All 7 giant garden games.",
    kind: "THE WHOLE COLLECTION",
  },
];
const golfPrices = [0, 100, 200, 275, 350, 400];

const gameMap = new Map(G.map(g=>[g.id,g]));
const price = ids => ids.reduce((sum,id)=>sum+gameMap.get(id).price,0);
function candidates({ids,choice,holes=0,automaticDiscount=0}) {
  if(!Array.isArray(ids)||new Set(ids).size!==ids.length||ids.some(id=>!gameMap.has(id))||!Number.isInteger(holes)||holes<0||holes>5) return [];
  if(choice==="the_mix" && ids.length<4) return [];
  return P.filter(p=>p.id!==choice).map(p=>{
    const included=[];
    for(const [tier,count] of [["premium",p.p],["classic",p.c]]) {
      const wanted=ids.filter(id=>gameMap.get(id).tier===tier);
      const remaining=G.filter(g=>g.tier===tier&&!wanted.includes(g.id)).map(g=>g.id);
      included.push(...[...wanted,...remaining].slice(0,count));
    }
    const extras=ids.filter(id=>!included.includes(id));
    const added=included.filter(id=>!ids.includes(id));
    const cost=p.price+price(extras)+golfPrices[holes]-Math.min(golfPrices[holes],Math.max(0,automaticDiscount));
    return {p,included,extras,added,golf:holes,cost};
  });
}
function best(candidates,currentCost) {
  const round=n=>Math.round((n+Number.EPSILON)*100)/100;
  const options=candidates.map(d=>({...d,delta:round(d.cost-currentCost)}));
  const savings=options.filter(d=>d.delta<0).sort((a,b)=>a.delta-b.delta||a.added.length-b.added.length);
  if(savings.length)return savings[0];
  const upgrades=options.filter(d=>d.added.length>0&&d.delta>=0&&d.delta<=75).sort((a,b)=>a.delta-b.delta||b.added.length-a.added.length);
  return upgrades[0]||null;
}
root.OTGGSelection={G,P,golfPrices,price,candidates,best};
})(typeof window!=="undefined"?window:globalThis);
