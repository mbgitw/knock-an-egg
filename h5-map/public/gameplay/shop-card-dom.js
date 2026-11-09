// Keep the actual buttons alive between pointerdown and click. Passive income
// may refresh a shop at any time; replacing innerHTML silently cancels a press.
const previousMarkup=new WeakMap();
export function updateShopCards(container,markup){
  const previous=previousMarkup.get(container);
  if(previous?.markup===markup&&previous.first===container.firstChild)return false;
  const template=document.createElement('template');template.innerHTML=markup;
  reconcile(container,template.content);
  previousMarkup.set(container,{markup,first:container.firstChild});
  return true;
}

function reconcile(current,next){
  const children=[...next.childNodes];
  for(let i=0;i<children.length;i++){
    const incoming=children[i],existing=current.childNodes[i];
    if(!existing){current.append(incoming.cloneNode(true));continue;}
    if(existing.nodeType!==incoming.nodeType||existing.nodeName!==incoming.nodeName){existing.replaceWith(incoming.cloneNode(true));continue;}
    if(existing.nodeType===Node.TEXT_NODE){if(existing.data!==incoming.data)existing.data=incoming.data;continue;}
    if(existing.nodeType!==Node.ELEMENT_NODE)continue;
    for(const attr of [...existing.attributes])if(!incoming.hasAttribute(attr.name))existing.removeAttribute(attr.name);
    for(const attr of incoming.attributes)if(existing.getAttribute(attr.name)!==attr.value)existing.setAttribute(attr.name,attr.value);
    reconcile(existing,incoming);
  }
  while(current.childNodes.length>children.length)current.lastChild.remove();
}
