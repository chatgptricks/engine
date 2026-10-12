// A small DOM surface for exercising the editor's real run traversal and Range
// mutations. This intentionally has no formatting or sanitization implementation.
export function installRichDom() {
  const previous = Object.fromEntries(["Node", "HTMLElement", "document", "window"].map(key => [key, globalThis[key]]));
  class DomNode {
    constructor(type, text="") { this.nodeType=type; this.data=text; this.childNodes=[]; this.parentElement=null; }
    get textContent() { return this.nodeType===3 ? this.data : this.childNodes.map(node=>node.textContent).join(""); }
    get nextSibling() { const siblings=this.parentElement?.childNodes??[]; return siblings[siblings.indexOf(this)+1]??null; }
    contains(node) { return this===node || this.childNodes.some(child=>child.contains(node)); }
    appendChild(node) { node.parentElement=this; this.childNodes.push(node); return node; }
  }
  class DomElement extends DomNode {
    constructor(tag="div",attrs="") {
      super(1);this.tagName=tag.toUpperCase();this.style={textDecoration:"",textDecorationLine:"",fontWeight:"",fontStyle:"",color:"",fontSize:""};
      for(const declaration of (attrs.match(/style="([^"]*)"/)?.[1]??"").split(";")) {
        const [key,...rest]=declaration.split(":");if(!rest.length)continue;
        this.style[key.trim().replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=rest.join(":").trim();
      }
      this.attributes=Object.fromEntries([...attrs.matchAll(/([a-z-]+)="([^"]*)"/g)].map(match=>[match[1],match[2]]));
      this.classList=(attrs.match(/class="([^"]*)"/)?.[1]??"").split(/\s+/).filter(Boolean);
    }
    getAttribute(name) {return this.attributes[name]??null;}
    set innerHTML(html) {
      this.childNodes=[];const stack=[this];
      for(const token of html.match(/<[^>]+>|[^<]+/g)??[]) {
        if(/^<\//.test(token)) { stack.pop();continue; }
        const tag=token.match(/^<(\w+)(.*?)>$/);
        if(tag) { const node=stack.at(-1).appendChild(new DomElement(tag[1],tag[2]));if(tag[1]!=="br")stack.push(node); }
        else stack.at(-1).appendChild(new DomNode(3,token.replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&")));
      }
    }
  }
  class DomRange {
    constructor(root) { this.root=root;this.startContainer=root;this.endContainer=root;this.startOffset=0;this.endOffset=root.childNodes.length; }
    get collapsed() { return this.startContainer===this.endContainer&&this.startOffset===this.endOffset; }
    get commonAncestorContainer() { return this.root; }
    setStart(node,offset) { this.startContainer=node;this.startOffset=offset; }
    setEnd(node,offset) { this.endContainer=node;this.endOffset=offset; }
    setStartBefore(node) { this.setStart(node.parentElement,node.parentElement.childNodes.indexOf(node)); }
    setStartAfter(node) { this.setStart(node.parentElement,node.parentElement.childNodes.indexOf(node)+1); }
    setEndBefore(node) { this.setEnd(node.parentElement,node.parentElement.childNodes.indexOf(node)); }
    setEndAfter(node) { this.setEnd(node.parentElement,node.parentElement.childNodes.indexOf(node)+1); }
  }
  const selection={ranges:[],removeAllRanges(){this.ranges=[];},addRange(range){this.ranges.push(range);}};
  let nativeCalls=0;
  globalThis.Node=DomNode;globalThis.HTMLElement=DomElement;
  globalThis.document={activeElement:null,execCommand(){nativeCalls++;return true;}};
  globalThis.window={getSelection:()=>selection};
  return {
    node(html,style={}) { const node=new DomElement();node.innerHTML=html;Object.assign(node.style,style);return node; },
    range(root) { return new DomRange(root); },
    textNodes(node) { return node.nodeType===3?[node]:node.childNodes.flatMap(child=>this.textNodes(child)); },
    get nativeCalls(){return nativeCalls;},selection,
    restore(){for(const [key,value] of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}},
  };
}
