(function(){"use strict";
const root=document.getElementById("weddingTimeline");if(!root)return;
const stages=[
["Arrival","Ready when your guests arrive","Everything can be set up before the celebrations begin.","Example: 12pm"],
["Drinks reception","A little friendly competition","Keep guests entertained while you have your photographs taken.","Example: 2pm"],
["Wedding breakfast","Play between the formalities","Guests can dip in and out whenever there is a break in the day.","Example: 4pm"],
["Evening guests","A warm welcome for everyone","New arrivals can join in the fun without a new hire slot.","Example: 7pm"],
["Evening celebrations","Keep the games going","Enjoy the games until your agreed collection time, with no extension fees.","Example: 9pm"]];
const range=root.querySelector("#weddingTime"),buttons=[...root.querySelectorAll("[data-stage]")];
function update(){const i=Number(range.value),s=stages[i];if(!s)return;
["timelineLabel","timelineTitle","timelineCopy","timelineTime"].forEach((id,j)=>root.querySelector("#"+id).textContent=s[j]);
range.setAttribute("aria-valuetext",s[0]);buttons.forEach((b,j)=>b.setAttribute("aria-pressed",String(j===i)));}
range.addEventListener("input",update);buttons.forEach(b=>b.addEventListener("click",()=>{range.value=b.dataset.stage;update();}));update();
})();
