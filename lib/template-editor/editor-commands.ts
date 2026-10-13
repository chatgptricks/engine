export type EditorCommandId = "text" | "rectangle" | "ellipse" | "undo" | "redo" | "duplicate" | "copy" | "cut" | "paste" | "group" | "ungroup" | "forward" | "backward" | "front" | "back" | "select-all" | "nudge" | "delete" | "escape" | "pan" | "hand" | "select" | "nodes" | "pen" | "zoom-in" | "zoom-out" | "fit";
type KeyEvent = {key:string;ctrlKey:boolean;metaKey:boolean;shiftKey:boolean;altKey:boolean;isComposing?:boolean};
type EditorCommand = {id:EditorCommandId;label:string;shortcut:string;keys:readonly string[];primary?:boolean;shift?:boolean|"any"};
/** Display and execution consume this same registry, including alternate keys. */
export const EDITOR_COMMANDS:readonly EditorCommand[] = [
  {id:"text",label:"Add text",shortcut:"T",keys:["t"]},
  {id:"rectangle",label:"Add rectangle",shortcut:"R",keys:["r"]},
  {id:"ellipse",label:"Add circle",shortcut:"O",keys:["o"]},
  {id:"undo",label:"Undo",shortcut:"⌘/Ctrl Z",keys:["z"],primary:true},
  {id:"redo",label:"Redo",shortcut:"⌘/Ctrl Shift Z · Ctrl Y",keys:["z"],primary:true,shift:true},
  {id:"redo",label:"Redo",shortcut:"Ctrl Y",keys:["y"],primary:true,shift:"any"},
  {id:"duplicate",label:"Duplicate selection",shortcut:"⌘/Ctrl D",keys:["d"],primary:true},
  {id:"copy",label:"Copy selection",shortcut:"⌘/Ctrl C",keys:["c"],primary:true},
  {id:"cut",label:"Cut selection",shortcut:"⌘/Ctrl X",keys:["x"],primary:true},
  {id:"paste",label:"Paste",shortcut:"⌘/Ctrl V",keys:["v"],primary:true},
  {id:"group",label:"Group selection",shortcut:"⌘/Ctrl G",keys:["g"],primary:true},
  {id:"ungroup",label:"Ungroup selection",shortcut:"⌘/Ctrl Shift G",keys:["g"],primary:true,shift:true},
  {id:"forward",label:"Bring forward",shortcut:"⌘/Ctrl ]",keys:["]"],primary:true},
  {id:"backward",label:"Send backward",shortcut:"⌘/Ctrl [",keys:["["],primary:true},
  {id:"front",label:"Bring to front",shortcut:"⌘/Ctrl Shift ]",keys:["]","}"],primary:true,shift:true},
  {id:"back",label:"Send to back",shortcut:"⌘/Ctrl Shift [",keys:["[","{"],primary:true,shift:true},
  {id:"select-all",label:"Select all unlocked elements",shortcut:"⌘/Ctrl A",keys:["a"],primary:true},
  {id:"nudge",label:"Move selection · Shift for larger steps",shortcut:"Arrows · Shift + arrows",keys:["arrowleft","arrowright","arrowup","arrowdown"],shift:"any"},
  {id:"delete",label:"Delete selection",shortcut:"Delete / Backspace",keys:["delete","backspace"]},
  {id:"escape",label:"Deselect / cancel gesture",shortcut:"Escape",keys:["escape"]},
  {id:"pan",label:"Pan canvas while holding Space",shortcut:"Space + drag",keys:[" "]},
  {id:"hand",label:"Hand tool",shortcut:"H",keys:["h"]},
  {id:"select",label:"Selection tool",shortcut:"V",keys:["v"]},
  {id:"nodes",label:"Edit path nodes",shortcut:"A",keys:["a"]},
  {id:"pen",label:"Draw path",shortcut:"P",keys:["p"]},
  {id:"zoom-in",label:"Zoom in",shortcut:"⌘/Ctrl +",keys:["+","="],primary:true,shift:"any"},
  {id:"zoom-out",label:"Zoom out",shortcut:"⌘/Ctrl −",keys:["-"],primary:true},
  {id:"fit",label:"Fit page",shortcut:"⌘/Ctrl 0",keys:["0"],primary:true},
];
export const EDITOR_GESTURES = [
  {label:"Duplicate while moving",shortcut:"Alt + drag"},
  {label:"Select several layers",shortcut:"Shift + click / drag empty space"},
  {label:"Select another layer underneath",shortcut:"⌘/Ctrl + click"},
  {label:"Resize from center",shortcut:"Alt + resize"},
  {label:"Keep proportions / snap rotation",shortcut:"Shift + resize / rotate"},
  {label:"Navigate on touch devices",shortcut:"Two fingers: pan & pinch"},
  {label:"Open actions menu",shortcut:"Shift F10"},
];
export function resolveEditorCommand(event:KeyEvent):EditorCommandId|null {
  if(event.isComposing||event.altKey)return null;
  const key=event.key.toLowerCase(),primary=event.ctrlKey||event.metaKey;
  return EDITOR_COMMANDS.find(command=>command.keys.includes(key)&&Boolean(command.primary)===primary&&(command.shift==="any"||Boolean(command.shift)===event.shiftKey))?.id??null;
}
export function editorCommandHelp():{label:string;shortcut:string}[] {
  const seen=new Set<string>();return [...EDITOR_COMMANDS.filter(command=>{if(seen.has(command.id))return false;seen.add(command.id);return true;}),...EDITOR_GESTURES].map(({label,shortcut})=>({label,shortcut}));
}
