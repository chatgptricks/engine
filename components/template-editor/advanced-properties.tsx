"use client";
import { editGradientStop } from "@/lib/template-editor/editing-actions";

import { useEffect, useState } from "react";
import type { TextFormattingPatch } from "@/lib/template-editor/rich-text-editing";
import type { CanvasElement, ImageElement, ShapeElement, TextElement, TextStyle } from "@/lib/template-editor/model";
import { commonValue, imageResolution } from "@/lib/template-editor/property-utils";
import { updatePhotoContent } from "@/lib/template-editor/photo-frames";
import { ColorField, NumberField } from "./controls";

export type ColorRoleOption = { id: string; name: string; color: string };
export type AdvancedPropertySection = "text"|"texture"|"photo"|"shape"|"path"|"outline"|"effects"|"brand"|"constraints";
export type AdvancedPropertiesProps = {
  sections?: readonly AdvancedPropertySection[];
  styleDisabled?: boolean;
  contentDisabled?: boolean;
  positionDisabled?: boolean;
  photoFitControls?: boolean;
  onFormatText?: (patch:TextFormattingPatch)=>boolean;
  elements: CanvasElement[];
  outputScale?: number;
  update: (group: string, transform: (element: CanvasElement) => CanvasElement) => void;
  textStyles?: TextStyle[];
  onSaveTextStyle?: (style: TextStyle) => void;
  onDeleteTextStyle?: (id: string) => void;
  colorRoles?: ColorRoleOption[];
  onSaveColorRole?: (role: ColorRoleOption) => void;
  onDeleteColorRole?: (id: string) => void;
  onUploadTextTexture?: (file: File) => Promise<void>;
  onClearTextTexture?: () => void;
  onUploadFramePhoto?: (file: File, shapeId: string) => Promise<void>;
};

function common<T>(items: readonly T[], value: (item: T) => string | number | boolean): ReturnType<typeof value> | undefined {
  const first = items[0] && value(items[0]);
  return items.every(item => value(item) === first) ? first : undefined;
}
function Section({ title, children, disclosure = true }: { title: string; children: React.ReactNode; disclosure?: boolean }) {
  return disclosure ? <details className="te-element-section te-advanced-section"><summary>{title}</summary><div>{children}</div></details> : <section className="te-element-section"><h3>{title}</h3>{children}</section>;
}
function Select({ label, value, options, onChange }: { label: string; value: string | undefined; options: readonly (readonly [string, string])[]; onChange: (value: string) => void }) {
  return <label className="te-field">{label}<select aria-label={label} value={value ?? ""} onChange={event => onChange(event.target.value)}>{value === undefined && <option value="" disabled>Mixed</option>}{options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>;
}
function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="te-property-check"><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />{label}</label>;
}

export function ColorRolesPanel({ roles, onSave, onDelete, onApply }: { roles: ColorRoleOption[]; onSave?: (role: ColorRoleOption) => void; onDelete?: (id: string) => void; onApply?: (role: ColorRoleOption) => void }) {
  const [draft, setDraft] = useState<ColorRoleOption>({ id: "", name: "", color: "#ffffff" });
  const [confirmDelete, setConfirmDelete] = useState("");
  useEffect(() => { if (!confirmDelete) return; const timer = window.setTimeout(() => setConfirmDelete(""), 3000); return () => window.clearTimeout(timer); }, [confirmDelete]);
  if (!roles.length && !onSave) return null;
  return <Section title="Brand color roles"><div className="te-color-roles">{roles.map(role => <div className="te-color-role" key={role.id}><button type="button" disabled={!onApply} onClick={() => onApply?.(role)} aria-label={`Apply color role ${role.name}`}><span style={{ background: role.color }} />{role.name}</button>{onSave && <button type="button" aria-label={`Edit color role ${role.name}`} onClick={() => setDraft(role)}>Edit</button>}{onDelete && <button type="button" aria-label={`Remove color role ${role.name}`} onClick={() => { if (confirmDelete === role.id) { onDelete(role.id); setConfirmDelete(""); } else setConfirmDelete(role.id); }}>{confirmDelete === role.id ? "Remove?" : "×"}</button>}</div>)}</div>{onSave && <><label className="te-field">Role name<input aria-label="Color role name" value={draft.name} maxLength={100} placeholder="Primary, accent, surface…" onChange={event => setDraft({ ...draft, name: event.target.value })} /></label><ColorField label="Role color" value={draft.color} onChange={color => setDraft({ ...draft, color })} /><div className="te-element-grid te-element-actions"><button type="button" disabled={!draft.name.trim()} onClick={() => { onSave({ ...draft, id: draft.id || crypto.randomUUID(), name: draft.name.trim() }); setDraft({ id: "", name: "", color: "#ffffff" }); }}>{draft.id ? "Update role" : "Save role"}</button>{draft.id && <button type="button" onClick={() => setDraft({ id: "", name: "", color: "#ffffff" })}>New role</button>}</div></>}</Section>;
}

export function AdvancedProperties({ elements, update, textStyles = [], onSaveTextStyle, onDeleteTextStyle, colorRoles = [], onSaveColorRole, onDeleteColorRole, onUploadTextTexture, onClearTextTexture, onUploadFramePhoto, sections, outputScale = 3, styleDisabled=false,contentDisabled=false,positionDisabled=false,photoFitControls=true,onFormatText }: AdvancedPropertiesProps) {
  const show=(section:AdvancedPropertySection)=>!sections||sections.includes(section);
  const px = (value: number | undefined) => value === undefined ? undefined : Number((value * outputScale).toFixed(2));
  const [styleName, setStyleName] = useState("");
  const [uploading,setUploading]=useState(false),[uploadError,setUploadError]=useState("");
  const uploadPhoto=async(file:File,shapeId?:string)=>{setUploading(true);setUploadError("");try{if(shapeId)await onUploadFramePhoto?.(file,shapeId);else await onUploadTextTexture?.(file);}catch(error){setUploadError(error instanceof Error?error.message:"Could not load this photo.");}finally{setUploading(false);}};
  const texts = elements.filter((item): item is TextElement => item.type === "text");
  const images:ImageElement[] = elements.flatMap(item=>item.type === "image" ? [item] : item.type === "shape" && item.imageFill ? [{...item,...item.imageFill,type:"image" as const,fit:item.imageFill.objectFit,radius:0}] : []);
  const photoFrames=elements.filter((item):item is ShapeElement=>item.type==="shape"&&Boolean(item.imageFill));
  const shapes = elements.filter((item): item is ShapeElement => item.type === "shape");
  const patchText = (patch: Partial<TextElement>, group = "text-layout") => {if(styleDisabled)return;if(group!=="apply-text-style"&&["font","fontSize","fontWeight","italic","underline","strikethrough","color"].some(key=>key in patch)&&onFormatText?.(patch))return;update(group, item => item.type === "text" ? { ...item, ...patch } : item);};
  const patchImage = (patch: Partial<ImageElement>, group = "image-crop") => update(group, item => item.type === "image" ? { ...item, ...patch } : updatePhotoContent(item,patch));
  const patchShape = (patch: Partial<ShapeElement>) => update("shape-path", item => item.type === "shape" ? { ...item, ...patch } : item);
  const gradient = elements.find(item => item.gradient)?.gradient ?? { type: "linear" as const, angle: 90, stops: [{ color: "#ffffff", position: 0 }, { color: "#000000", position: 100 }] };
  const shadow = elements.find(item => item.shadow)?.shadow ?? { color: "#000000", offsetX: 0, offsetY: 4, blur: 12, spread: 0 };
  const patchGradient = (patch: Partial<NonNullable<CanvasElement["gradient"]>>) => update("gradient", item => ({ ...item, gradient: { ...(item.gradient ?? gradient), ...patch } }));
  const patchShadow = (patch: Partial<NonNullable<CanvasElement["shadow"]>>) => update("shadow", item => ({ ...item, shadow: { ...(item.shadow ?? shadow), ...patch } }));
  const allGradient = elements.every(item => Boolean(item.gradient));
  const allShadow = elements.every(item => Boolean(item.shadow));
  const blendModes = ["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"] as const;
  const styleId = common(texts, item => item.textStyleId ?? "") as string | undefined;
  return <>
    {show("text") && texts.length > 0 && <Section title="Text box & saved styles"><fieldset disabled={styleDisabled}>
      <Select label="Text sizing" value={common(texts, item => item.textMode ?? "fixed") as string | undefined} options={[["fixed", "Fixed box"], ["auto-height", "Auto height"], ["auto-fit", "Fit text to box"]]} onChange={value => patchText({ textMode: value as TextElement["textMode"] })} />
      {texts.some(item=>item.textMode==="auto-fit")&&<div className="te-element-grid"><NumberField label="Minimum fitted size" unit="px" min={outputScale} max={500*outputScale} value={px(common(texts,item=>item.autoFitMinFontSize??1) as number|undefined)} onChange={value=>update("text-fit-limits",item=>item.type==="text"?{...item,autoFitMinFontSize:value/outputScale,autoFitMaxFontSize:Math.max(value/outputScale,item.autoFitMaxFontSize??item.fontSize)}:item)}/><NumberField label="Maximum fitted size" unit="px" min={outputScale} max={500*outputScale} value={px(common(texts,item=>item.autoFitMaxFontSize??item.fontSize) as number|undefined)} onChange={value=>update("text-fit-limits",item=>item.type==="text"?{...item,autoFitMaxFontSize:value/outputScale,autoFitMinFontSize:Math.min(value/outputScale,item.autoFitMinFontSize??1)}:item)}/></div>}
      <Select label="Vertical text alignment" value={common(texts, item => item.verticalAlign ?? "top") as string | undefined} options={[["top", "Top"], ["middle", "Middle"], ["bottom", "Bottom"]]} onChange={value => patchText({ verticalAlign: value as TextElement["verticalAlign"] })} />
      <div className="te-element-grid"><NumberField label="Text padding" unit="px" min={0} max={1080} value={px(common(texts, item => item.padding ?? 0) as number | undefined)} onChange={value => patchText({ padding: value / outputScale })} />
        <NumberField label="Paragraph spacing" unit="px" min={0} max={600} value={px(common(texts, item => item.paragraphSpacing ?? 0) as number | undefined)} onChange={value => patchText({ paragraphSpacing: value / outputScale })} /></div>
      <Select label="List style" value={common(texts, item => item.listStyle ?? "none") as string | undefined} options={[["none", "None"], ["bullet", "Bullets"], ["number", "Numbered"]]} onChange={value => patchText({ listStyle: value as TextElement["listStyle"] })} />
      <Check label="Strikethrough" checked={texts.every(item => item.strikethrough)} onChange={strikethrough => patchText({ strikethrough })} />
      {onSaveTextStyle && <>
        <Select label="Reusable text style" value={styleId} options={[["", "Custom"], ...textStyles.map(item => [item.id, item.name] as const)]} onChange={id => { const style = textStyles.find(item => item.id === id); if (style) { const { id: styleId, name, ...patch } = style; setStyleName(name); patchText({ ...patch, textStyleId: styleId }, "apply-text-style"); } }} />
        <label className="te-field">Style name<input aria-label="Text style name" maxLength={100} value={styleName} placeholder="Heading, body, caption…" onChange={event => setStyleName(event.target.value)} /></label>
        <div className="te-element-grid te-element-actions"><button type="button" disabled={texts.length !== 1 || !styleName.trim()} onClick={() => {
          const item = texts[0];
          const id = textStyles.find(style => style.name === styleName.trim())?.id ?? crypto.randomUUID();
          onSaveTextStyle({ id, name: styleName.trim(), font: item.font, fontSize: item.fontSize, fontWeight: item.fontWeight, italic: item.italic, underline: item.underline, color: item.color, align: item.align, lineHeight: item.lineHeight, letterSpacing: item.letterSpacing, verticalAlign: item.verticalAlign, padding: item.padding, paragraphSpacing: item.paragraphSpacing, strikethrough: item.strikethrough, listStyle: item.listStyle, textureFill: item.textureFill, autoFitMinFontSize: item.autoFitMinFontSize, autoFitMaxFontSize: item.autoFitMaxFontSize });
          setStyleName("");
        }}>Save style</button>{onDeleteTextStyle && <button type="button" disabled={!styleId} onClick={() => styleId && onDeleteTextStyle(styleId)}>Remove style</button>}</div>
      </>}
    </fieldset></Section>}
    {show("texture") && texts.length>0 && (onUploadTextTexture || texts.some(item=>item.textureFill||item.wordTextures?.length)) && <Section title="Text image texture"><fieldset disabled={styleDisabled||contentDisabled}>
      <p className="te-element-hint">Select words on the canvas to texture those words, or apply a photo to the entire text.</p>
      {onUploadTextTexture && <label className="te-property-action">{uploading?"Loading texture…":"Choose texture photo"}<input type="file" aria-label="Choose text texture photo" accept="image/png,image/jpeg,image/webp" disabled={uploading} onChange={event=>{const file=event.target.files?.[0];event.target.value="";if(file)void uploadPhoto(file);}} /></label>}
      {onClearTextTexture && <button className="te-property-action" type="button" onClick={onClearTextTexture}>Remove text texture</button>}
      {uploadError&&<p className="te-element-hint" role="alert">{uploadError}</p>}
    </fieldset></Section>}
    {show("photo") && images.length > 0 && <Section title="Crop & image settings"><fieldset disabled={styleDisabled}>
      {photoFitControls&&<Select label="Photo fit" value={commonValue(images,"fit")} options={[["cover","Fill frame"],["contain","Fit entire photo"]]} onChange={fit=>patchImage({fit:fit as ImageElement["fit"]})} />}
      <div className="te-element-grid"><NumberField label="Crop X" unit="%" min={0} max={100} value={commonValue(images, "cropX")} onChange={cropX => patchImage({ cropX })} /><NumberField label="Crop Y" unit="%" min={0} max={100} value={commonValue(images, "cropY")} onChange={cropY => patchImage({ cropY })} /></div>
      <NumberField label="Image zoom" unit="%" min={100} max={1000} value={(common(images, item => item.cropScale ?? 1) as number | undefined) === undefined ? undefined : Number(common(images, item => item.cropScale ?? 1)) * 100} onChange={value => patchImage({ cropScale: value / 100 })} />
      <div className="te-element-grid"><Check label="Flip horizontal" checked={images.every(item => item.flipX)} onChange={flipX => patchImage({ flipX }, "image-flip")} /><Check label="Flip vertical" checked={images.every(item => item.flipY)} onChange={flipY => patchImage({ flipY }, "image-flip")} /></div>
      {elements.some(item=>item.type==="image") && <Select label="Image mask" value={common(images, item => item.mask ?? "none") as string | undefined} options={[["none", "Rectangle"], ["ellipse", "Ellipse"], ["triangle", "Triangle"], ["diamond", "Diamond"]]} onChange={mask => patchImage({ mask: mask as ImageElement["mask"] }, "image-mask")} />}
      <div className="te-focal-grid" role="group" aria-label="Image focal point">{[0, 50, 100].flatMap(y => [0, 50, 100].map(x => <button key={`${x}-${y}`} type="button" title={`Focal point ${x}%, ${y}%`} aria-label={`Focal point ${x}%, ${y}%`} aria-pressed={images.every(item => item.cropX === x && item.cropY === y)} onClick={() => patchImage({ cropX: x, cropY: y })}>·</button>))}</div>
      <button className="te-property-action" type="button" onClick={() => patchImage({ cropX: 50, cropY: 50, cropScale: 1, flipX: false, flipY: false, mask: "none" }, "reset-image-crop")}>Reset crop & orientation</button>
      </fieldset>{photoFrames.length>0 && <button disabled={contentDisabled} className="te-property-action" type="button" onClick={()=>update("image-fill",item=>item.type==="shape"?{...item,imageFill:undefined}:item)}>Remove photo from frame</button>}
      {images.length === 1 && images[0].intrinsicWidth && <p className="te-element-hint">Source {images[0].intrinsicWidth} × {images[0].intrinsicHeight} px{imageResolution(images[0], outputScale)?.low ? " · Below export resolution at this size" : " · Enough detail for export"}</p>}
    </Section>}
    {show("shape") && shapes.length > 0 && <Section title="Shape geometry"><fieldset disabled={styleDisabled}>
      <Select label="Shape geometry" value={commonValue(shapes, "shape")} options={[["rectangle", "Rectangle"], ["ellipse", "Ellipse"], ["triangle", "Triangle"], ["diamond", "Diamond"], ["polygon", "Polygon"], ["star", "Star"], ["arrow", "Arrow"], ["path", "Custom SVG path"]]} onChange={shape => patchShape({ shape: shape as ShapeElement["shape"], ...(shape === "path" ? { path: "M 0 0 L 100 0 L 100 100 L 0 100 Z", viewBox: "0 0 100 100" } : {}) })} />
      {shapes.some(item => item.shape === "polygon") && <NumberField label="Polygon sides" min={3} max={32} value={common(shapes, item => item.sides ?? 6) as number | undefined} onChange={sides => patchShape({ sides: Math.round(sides) })} />}
      {shapes.some(item => item.shape === "star") && <div className="te-element-grid"><NumberField label="Star points" min={3} max={24} value={common(shapes, item => item.starPoints ?? 5) as number | undefined} onChange={starPoints => patchShape({ starPoints: Math.round(starPoints) })} /><NumberField label="Inner radius" unit="%" min={5} max={95} value={common(shapes, item => item.innerRadius ?? .5) === undefined ? undefined : Number(common(shapes, item => item.innerRadius ?? .5)) * 100} onChange={innerRadius => patchShape({ innerRadius: innerRadius / 100 })} /></div>}
      </fieldset><fieldset disabled={positionDisabled}><button className="te-property-action" type="button" onClick={() => update("square-shape", item => item.type === "shape" ? { ...item, height: item.width } : item)}>Make square / circle</button></fieldset>
    </Section>}
    {show("path")&&shapes.length===1&&shapes[0].shape==="path"&&<details className="te-element-section te-advanced-section"><summary>SVG path data</summary><fieldset disabled={styleDisabled}><label className="te-field">SVG path<textarea aria-label="SVG path data" rows={3} value={shapes[0].path ?? ""} maxLength={20000} onChange={event => patchShape({ path: event.target.value })} /></label><label className="te-field">View box<input aria-label="SVG path view box" value={shapes[0].viewBox ?? "0 0 100 100"} onChange={event => { if (/^\s*-?\d+(?:\.\d+)?\s+-?\d+(?:\.\d+)?\s+\d+(?:\.\d+)?\s+\d+(?:\.\d+)?\s*$/.test(event.target.value)) patchShape({ viewBox: event.target.value }); }} /></label></fieldset></details>}
    {show("outline")&&shapes.length>0&&<Section title="Outline pattern"><fieldset disabled={styleDisabled}>
      <Select label="Border dash" value={common(shapes, item => item.strokeDash?.length ? item.strokeDash.join(",") : "") as string | undefined} options={[["", "Solid"], ["4,4", "Dashed"], ["1,3", "Dotted"], ["8,3,2,3", "Dash dot"]]} onChange={value => patchShape({ strokeDash: value ? value.split(",").map(Number) : undefined })} />
    </fieldset></Section>}
    {show("effects") && <Section title="Shadow" disclosure={false}><fieldset disabled={styleDisabled}>
      <div className="te-effect-presets" role="group" aria-label="Shadow presets">
        {([
          {name:"None",value:undefined},
          {name:"Soft",value:{color:"#00000040",offsetX:0,offsetY:3,blur:8,spread:0}},
          {name:"Lift",value:{color:"#00000066",offsetX:0,offsetY:6,blur:5,spread:0}},
          {name:"Glow",value:{color:"#ffffff80",offsetX:0,offsetY:0,blur:8,spread:0}},
        ] as const).map(preset=><button type="button" key={preset.name} aria-label={`${preset.name} shadow`} aria-pressed={elements.every(item=>JSON.stringify(item.shadow)===JSON.stringify(preset.value))} disabled={styleDisabled} onClick={()=>{if(!styleDisabled)update("shadow-preset",item=>({...item,shadow:preset.value}));}}><span className={`te-effect-preview is-${preset.name.toLowerCase()}`} aria-hidden>Aa</span>{preset.name}</button>)}
      </div>
      <Section title="Custom shadow">
      <Check label="Drop shadow" checked={allShadow} onChange={checked => update("shadow", item => ({ ...item, shadow: checked ? item.shadow ?? shadow : undefined }))} />
      {elements.some(item => item.shadow) && <><ColorField label="Shadow color" value={common(elements, item => item.shadow?.color ?? "#000000") as string | undefined ?? "Mixed"} onChange={color => patchShadow({ color })} /><div className="te-element-grid">{(["offsetX", "offsetY", "blur", "spread"] as const).map(key => <NumberField key={key} label={`Shadow ${key === "offsetX" ? "X" : key === "offsetY" ? "Y" : key}`} unit="px" min={key === "blur" ? 0 : -600} max={600} value={px(common(elements, item => item.shadow?.[key] ?? shadow[key]) as number | undefined)} onChange={value => patchShadow({ [key]: value / outputScale })} />)}</div></>}
      </Section>
      <Section title="Blend & blur">
      <Select label="Blend mode" value={common(elements, item => item.blendMode ?? "normal") as string | undefined} options={blendModes.map(item => [item, item.replaceAll("-", " ")] as const)} onChange={blendMode => update("blend-mode", item => ({ ...item, blendMode: blendMode as CanvasElement["blendMode"] }))} />
      <NumberField label="Blur" unit="px" min={0} max={300} value={px(common(elements, item => item.blur ?? 0) as number | undefined)} onChange={value => update("blur", item => ({ ...item, blur: value / outputScale }))} />
      </Section>
      <Section title="Gradient settings">
      <Check label="Gradient fill" checked={allGradient} onChange={checked => update("gradient", item => ({ ...item, gradient: checked ? item.gradient ?? gradient : undefined }))} />
      {elements.some(item => item.gradient) && <>
        <p className="te-element-hint">{!allGradient || elements.some(item => JSON.stringify(item.gradient) !== JSON.stringify(gradient)) ? "Mixed gradient settings. Changes apply to the selection." : ""}</p><Select label="Gradient type" value={common(elements, item => item.gradient?.type ?? "") as string | undefined} options={[["linear", "Linear"], ["radial", "Radial"]]} onChange={type => patchGradient({ type: type as "linear" | "radial" })} />
        <NumberField label="Gradient angle" unit="°" min={-360} max={360} value={common(elements, item => item.gradient?.angle ?? 90) as number | undefined} onChange={angle => patchGradient({ angle })} />
        {gradient.stops.map((stop, index) => <div className="te-gradient-stop" key={index}><ColorField label={`Stop ${index + 1}`} value={common(elements, item => item.gradient?.stops[index]?.color ?? "") as string | undefined ?? "Mixed"} onChange={color => update("gradient", item => editGradientStop(item,index,{color}))} /><NumberField label={`Stop ${index + 1} position`} unit="%" min={0} max={100} value={common(elements, item => item.gradient?.stops[index]?.position ?? 0) as number | undefined} onChange={position => update("gradient", item => editGradientStop(item,index,{position}))} />{gradient.stops.length > 2 && <button className="te-property-action" type="button" onClick={() => update("gradient", item => editGradientStop(item,index,"remove"))}>Remove stop</button>}</div>)}
        <button className="te-property-action" type="button" disabled={elements.every(item=>(item.gradient?.stops.length??0)>=20)} onClick={() => update("gradient", item => editGradientStop(item,0,"add"))}>Add color stop</button>
      </>}
      </Section>
      <button className="te-property-action" type="button" onClick={() => update("reset-effects", item => ({ ...item, gradient: undefined, shadow: undefined, blur: 0, blendMode: "normal" }))}>Reset effects</button>
    </fieldset></Section>}
    {show("brand") && <ColorRolesPanel roles={colorRoles} onSave={onSaveColorRole} onDelete={onDeleteColorRole} onApply={styleDisabled?undefined:role => update("brand-color-role", item => item.type === "text" ? { ...item, color: role.color, colorRoleId: role.id } : item.type === "shape" ? { ...item, fill: role.color, colorRoleId: role.id } : item)} />}
    {show("constraints") && <Section title="Template slots & constraints">
      <label className="te-field">Content slot<input aria-label="Content slot" value={commonValue(elements, "slot") ?? ""} placeholder="headline, hero-image…" maxLength={100} onChange={event => update("slot", item => ({ ...item, slot: event.target.value.trim().slice(0, 100) }))} /></label>
      <Check label="Master element across slides" checked={elements.every(item => item.master)} onChange={master => update("master", item => ({ ...item, master }))} />
      <Select label="Horizontal anchor" value={common(elements, item => item.anchors?.horizontal ?? "left") as string | undefined} options={[["left", "Left"], ["center", "Center"], ["right", "Right"], ["stretch", "Stretch"]]} onChange={horizontal => update("anchor", item => ({ ...item, anchors: { horizontal: horizontal as NonNullable<CanvasElement["anchors"]>["horizontal"], vertical: item.anchors?.vertical ?? "top" } }))} />
      <Select label="Vertical anchor" value={common(elements, item => item.anchors?.vertical ?? "top") as string | undefined} options={[["top", "Top"], ["middle", "Middle"], ["bottom", "Bottom"], ["stretch", "Stretch"]]} onChange={vertical => update("anchor", item => ({ ...item, anchors: { horizontal: item.anchors?.horizontal ?? "left", vertical: vertical as NonNullable<CanvasElement["anchors"]>["vertical"] } }))} />
      <span className="te-element-label">Protect properties</span>{(["content", "position", "style", "delete"] as const).map(key => <Check key={key} label={key === "delete" ? "Prevent deletion" : `Protect ${key}`} checked={elements.every(item => item.protected?.includes(key))} onChange={checked => update("protection", item => ({ ...item, protected: checked ? [...new Set([...(item.protected ?? []), key])] : item.protected?.filter(value => value !== key) }))} />)}
    </Section>}
  </>;
}
