// Per-frame UI code calls these helpers so unchanged values never touch the DOM:
// assigning textContent/attributes, even to the same value, invalidates style and layout.
export function setText(el,value){const text=String(value);if(el.textContent!==text)el.textContent=text;}
export function setAttr(el,name,value){const text=String(value);if(el.getAttribute(name)!==text)el.setAttribute(name,text);}
export function setProp(el,name,value){if(el[name]!==value)el[name]=value;}
export function assignDataset(el,values){const data=el.dataset;for(const key in values){const text=String(values[key]);if(data[key]!==text)data[key]=text;}}
