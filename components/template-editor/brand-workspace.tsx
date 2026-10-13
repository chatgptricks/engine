"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { PlusIcon, TrashIcon, ImageIcon, LayoutIcon } from "@/components/engine/icons";
import { activeBrandKit, libraryBrandKits, withBrandKits, createBrandKit, type BrandAsset, type SavedBrandKit, type EditorLibrary } from "@/lib/template-editor/model";
import { proxied } from "@/lib/engine/util";
import { ColorField, FontSelect, Modal } from "./controls";
import { useContextMenu, type ContextMenuDefinition } from "./context-menu";
import "./brand-workspace.css";
import { prepareRasterAsset } from "@/lib/template-editor/client-media";
import { prepareVectorBrandAsset } from "@/lib/template-editor/brand-assets";
import { organizeBrandAsset } from "@/lib/template-editor/library-workflows";

/** Preserve raster originals privately and keep supported logos as passive vectors. */
export async function prepareBrandAsset(file: File, kind: BrandAsset["kind"]): Promise<BrandAsset> {
  if (file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg")) {
    if (file.size > 1_000_000) throw new Error("Choose an SVG smaller than 1 MB.");
    return prepareVectorBrandAsset(await file.text(), file.name, kind);
  }
  const asset = await prepareRasterAsset(file);
  return { id: crypto.randomUUID(), name: file.name.slice(0, 200), src: asset.src, previewSrc: asset.previewSrc, width: asset.width, height: asset.height, kind };
}

type Props = { library: EditorLibrary; canEdit: boolean; onChange: (update: (library: EditorLibrary) => EditorLibrary) => boolean | void };

export function BrandWorkspace({ library, canEdit, onChange }: Props) {
  const kits = libraryBrandKits(library);
  const kit = activeBrandKit(library);
  const { openMenu } = useContextMenu();
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadKind = useRef<BrandAsset["kind"]>("logo");
  const mounted = useRef(true);
  const latest = useRef({ library, canEdit });
  useEffect(() => { latest.current = { library, canEdit }; }, [library, canEdit]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState("");
  const [nameDialog, setNameDialog] = useState<{ kind: "new" | "kit" | "asset"; name: string; kitId?: string; assetId?: string } | null>(null);
  const [remove, setRemove] = useState<{ kind: "kit" | "asset"; name: string; kitId: string; assetId?: string } | null>(null);
  const [assetFilter, setAssetFilter] = useState<"all" | BrandAsset["kind"]>("all");
  const [assetSearch, setAssetSearch] = useState("");
  const [allKits, setAllKits] = useState(false);
  const [variantFilter,setVariantFilter]=useState<"all"|NonNullable<BrandAsset["variant"]>>("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [assetEdit, setAssetEdit] = useState<{kitId:string;assetId:string;tags:string;favorite:boolean;variant:NonNullable<BrandAsset["variant"]>;destination:string;copy:boolean}|null>(null);
  const assetResults = (allKits ? kits : [kit]).flatMap(owner => owner.assets.map(asset => ({owner,asset}))).filter(({asset}) => (assetFilter === "all" || asset.kind === assetFilter) && (variantFilter==="all"||(asset.variant??"universal")===variantFilter) && (!favoritesOnly || asset.favorite) && `${asset.name} ${(asset.tags ?? []).join(" ")}`.toLowerCase().includes(assetSearch.trim().toLowerCase()));
  const [newColor, setNewColor] = useState("#8c79e8");

  function updateKit(id: string, change: (kit: SavedBrandKit) => SavedBrandKit) {
    if (!latest.current.canEdit) return false;
    return onChange((current) => withBrandKits(current, libraryBrandKits(current).map((item) => item.id === id ? change(item) : item), current.activeBrandKitId));
  }
  function selectKit(id: string) {
    if (!latest.current.canEdit) return;
    onChange((current) => withBrandKits(current, libraryBrandKits(current), id));
  }
  function kitMenu(item: SavedBrandKit): ContextMenuDefinition {
    return { label: item.name || "Brand kit", items: [
      { id: "use", label: item.id === kit.id ? "Active brand kit" : "Use this brand kit", disabled: !canEdit || item.id === kit.id, onSelect: () => selectKit(item.id) },
      { id: "rename", label: "Rename kit", disabled: !canEdit, onSelect: () => setNameDialog({ kind: "kit", kitId: item.id, name: item.name }) },
      { id: "duplicate", label: "Duplicate kit", disabled: !canEdit || kits.length >= 20, onSelect: () => {
        if (!latest.current.canEdit) return;
        const duplicate = { ...item, id: crypto.randomUUID(), name: `${item.name.slice(0, 95)} copy`, palette: [...item.palette], assets: item.assets.map((asset) => ({ ...asset, id: crypto.randomUUID() })) };
        onChange((current) => {
          if (libraryBrandKits(current).length >= 20) throw new Error("Your workspace has reached its 20-brand-kit limit.");
          return withBrandKits(current, [...libraryBrandKits(current), duplicate], duplicate.id);
        });
      } },
      { id: "delete", label: "Delete kit…", disabled: !canEdit || kits.length <= 1, separator: true, danger: true, onSelect: () => setRemove({ kind: "kit", kitId: item.id, name: item.name }) },
    ] };
  }
  function assetMenu(asset: BrandAsset, ownerId = kit.id): ContextMenuDefinition {
    return { label: asset.name, items: [
      { id: "rename", label: "Rename asset", disabled: !canEdit, onSelect: () => setNameDialog({ kind: "asset", kitId: ownerId, assetId: asset.id, name: asset.name }) },
      { id: "favorite", label: asset.favorite ? "Remove favorite" : "Favorite asset", disabled: !canEdit, onSelect: () => updateKit(ownerId, current => ({...current, assets: current.assets.map(item => item.id === asset.id ? {...item, favorite: !item.favorite} : item)})) },
      { id: "organize", label: "Tags, variants & move/copy…", disabled: !canEdit, onSelect: () => setAssetEdit({kitId:ownerId,assetId:asset.id,tags:(asset.tags ?? []).join(", "),favorite:Boolean(asset.favorite),variant:asset.variant ?? "universal",destination:ownerId,copy:false}) },
      { id: "kind", label: asset.kind === "logo" ? "Move to images" : "Move to logos", disabled: !canEdit, onSelect: () => updateKit(ownerId, (current) => ({ ...current, assets: current.assets.map((item) => item.id === asset.id ? { ...item, kind: item.kind === "logo" ? "image" : "logo" } : item) })) },
      { id: "delete", label: "Delete asset…", disabled: !canEdit, danger: true, separator: true, onSelect: () => setRemove({ kind: "asset", kitId: ownerId, assetId: asset.id, name: asset.name }) },
    ] };
  }
  function chooseUpload(kind: BrandAsset["kind"]) {
    if (!latest.current.canEdit || uploading) return;
    uploadKind.current = kind;
    fileRef.current?.click();
  }
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length || !latest.current.canEdit || uploading) return;
    const kitId = kit.id;
    const kind = uploadKind.current;
    setUploading(true); setNotice("");
    let added = 0;
    try {
      const existing = libraryBrandKits(latest.current.library).find((item) => item.id === kitId);
      if (!existing) throw new Error("This kit was removed. Select a kit and try again.");
      if (existing.assets.length + files.length > 40) throw new Error("Each brand kit supports up to 40 assets. Select fewer files.");
      const assets: BrandAsset[] = [];
      for (const file of files) {
        const asset = await prepareBrandAsset(file, kind);
        if (!mounted.current || !latest.current.canEdit) return;
        assets.push(asset);
      }
      const target = libraryBrandKits(latest.current.library).find((item) => item.id === kitId);
      if (!target) throw new Error("This kit was removed before the upload finished.");
      if (target.assets.length + assets.length > 40) throw new Error("This kit reached its 40-asset limit. Try fewer files.");
      const accepted = onChange((current) => {
        if (!latest.current.canEdit) throw new Error("This workspace is no longer editable.");
        const currentKits = libraryBrandKits(current);
        const destination = currentKits.find((item) => item.id === kitId);
        if (!destination) throw new Error("This brand kit was removed before the upload finished.");
        if (destination.assets.length + assets.length > 40) throw new Error("This kit reached its 40-asset limit.");
        return withBrandKits(current, currentKits.map((item) => item.id === kitId ? { ...item, assets: [...item.assets, ...assets] } : item), current.activeBrandKitId);
      });
      if (accepted === false) { setNotice("These assets could not be saved. Check the workspace save message."); return; }
      added = assets.length;
      setNotice(`${added} ${added === 1 ? "asset" : "assets"} added. Open Brand in any design to use ${added === 1 ? "it" : "them"}.`);
    } catch (error) {
      if (mounted.current) setNotice(error instanceof Error ? error.message : "Could not upload these files.");
    } finally { if (mounted.current) setUploading(false); }
  }
  const workspaceMenu: ContextMenuDefinition = { label: "Brand workspace", items: [
    { id: "new-kit", label: "New brand kit", disabled: !canEdit || kits.length >= 20, onSelect: () => setNameDialog({ kind: "new", name: "Untitled brand" }) },
    { id: "logo", label: "Upload logos…", disabled: !canEdit || uploading || kit.assets.length >= 40, onSelect: () => chooseUpload("logo") },
    { id: "image", label: "Upload images…", disabled: !canEdit || uploading || kit.assets.length >= 40, onSelect: () => chooseUpload("image") },
  ] };

  return <div className="te-brand-workspace" onContextMenu={(event) => openMenu(event, workspaceMenu)}>
    <div className="te-section-heading">
      <div><span className="te-eyebrow">EVERY BRAND, READY TO CREATE</span><h1>Your brand kits</h1><p>Keep colors, type, logos, and reusable images together.</p></div>
      <button className="te-button te-primary" disabled={!canEdit || kits.length >= 20} onClick={() => setNameDialog({ kind: "new", name: "Untitled brand" })}><PlusIcon /> New brand kit</button>
    </div>
    {notice && <div className="te-notice te-brand-notice" role="status"><span>{notice}</span><button className="te-icon" aria-label="Dismiss brand message" onClick={() => setNotice("")}>×</button></div>}
    <div className="te-brand-kit-list" aria-label="Brand kits">
      {kits.map((item) => <div key={item.id} className={`te-brand-kit-card${item.id === kit.id ? " is-active" : ""}`} onContextMenu={(event) => openMenu(event, kitMenu(item))}>
        <button className="te-brand-kit-select" disabled={!canEdit} aria-pressed={item.id === kit.id} aria-label={`Use ${item.name || "brand kit"}`} onClick={() => selectKit(item.id)}>
          <span className="te-brand-kit-monogram" style={{ background: item.background, color: item.text }}>{(item.name || "B").slice(0, 1).toUpperCase()}</span>
          <span><strong>{item.name || "Untitled brand"}</strong><small>{item.id === kit.id ? "Active brand" : `${item.assets.length} assets`}</small></span>
        </button>
        <button className="te-icon te-brand-dots" aria-haspopup="menu" aria-label={`Actions for ${item.name || "brand kit"}`} onClick={(event) => openMenu(event, kitMenu(item))}>⋯</button>
      </div>)}
    </div>
    <div className="te-brand-detail" key={kit.id}>
      <section className="te-brand-foundation">
        <div className="te-brand-panel-title"><h2>Brand essentials</h2><span>Autosaved</span></div>
        <fieldset disabled={!canEdit}>
          <label className="te-field">Brand name<input aria-label="Brand name" maxLength={100} value={kit.name} onChange={(event) => updateKit(kit.id, (item) => ({ ...item, name: event.target.value }))} /></label>
          <FontSelect value={kit.font} onChange={(font) => updateKit(kit.id, (item) => ({ ...item, font }))} />
          <ColorField label="Default background" value={kit.background} onChange={(background) => updateKit(kit.id, (item) => ({ ...item, background }))} />
          <ColorField label="Default text" value={kit.text} onChange={(text) => updateKit(kit.id, (item) => ({ ...item, text }))} />
          <div className="te-brand-palette-heading"><h3>Palette</h3><span>{kit.palette.length}/20</span></div>
          <div className="te-brand-palette">
            {kit.palette.map((color, index) => <div className="te-brand-color" key={`${index}-${color}`}>
              <ColorField label={`Palette color ${index + 1}`} value={color} onChange={value => updateKit(kit.id, item => ({...item, palette:item.palette.map((previous,i) => i === index ? value : previous)}))} />
              <button type="button" className="te-icon" aria-label={`Remove palette color ${index + 1}`} onClick={() => updateKit(kit.id, (item) => ({ ...item, palette: item.palette.filter((_, i) => i !== index) }))}>×</button>
            </div>)}
          </div>
          <div className="te-brand-add-color"><ColorField label="New color" value={newColor} onChange={setNewColor} /><button type="button" className="te-icon" aria-label="Add palette color" title="Add palette color" disabled={kit.palette.length >= 20} onClick={() => updateKit(kit.id, (item) => item.palette.length >= 20 ? item : { ...item, palette: [...item.palette, newColor] })}><PlusIcon /></button></div>
        </fieldset>
        <div className={`te-brand-mini-preview gf-font-${kit.font}`} style={{ background: kit.background, color: kit.text }}><small>MADE FOR YOUR BRAND</small><strong>{kit.name || "Your next great idea."}</strong><span>A familiar signature, every time.</span></div>
      </section>
      <section className="te-brand-assets">
        <div className="te-brand-panel-title"><div><h2>Logos & brand elements</h2><p>Add them to any post from the editor’s Brand panel.</p></div><span>{kit.assets.length}/40</span></div>
        <div className="te-brand-upload-actions"><button className="te-button" disabled={!canEdit || uploading || kit.assets.length >= 40} onClick={() => chooseUpload("logo")}><LayoutIcon />{uploading ? "Processing…" : "Upload logos"}</button><button className="te-button" disabled={!canEdit || uploading || kit.assets.length >= 40} onClick={() => chooseUpload("image")}><ImageIcon />Upload images</button></div>
        <input ref={fileRef} type="file" hidden multiple accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg" onChange={upload} />
        <p className="te-brand-upload-help">PNG, JPG, WebP · original quality · SVG logos up to 1 MB</p>
        <div className="te-brand-asset-search"><input aria-label="Search brand assets" placeholder="Search names or tags" value={assetSearch} onChange={event=>setAssetSearch(event.target.value)}/><label><input type="checkbox" checked={allKits} onChange={event=>setAllKits(event.target.checked)}/>All kits</label><label><input type="checkbox" checked={favoritesOnly} onChange={event=>setFavoritesOnly(event.target.checked)}/>Favorites</label><label>Variant<select value={variantFilter} onChange={event=>setVariantFilter(event.target.value as typeof variantFilter)}><option value="all">All variants</option><option value="universal">Universal</option><option value="light">For light backgrounds</option><option value="dark">For dark backgrounds</option></select></label></div>
        <div className="te-brand-asset-filters" role="group" aria-label="Asset type">{(["all", "logo", "image"] as const).map((filter) => <button key={filter} className={assetFilter === filter ? "is-active" : ""} aria-pressed={assetFilter === filter} onClick={() => setAssetFilter(filter)}>{filter === "all" ? "All assets" : filter === "logo" ? "Logos" : "Images"}</button>)}</div>
        <div className="te-brand-asset-grid">
          {assetResults.map(({asset,owner}) => <article className="te-brand-asset-card" key={`${owner.id}:${asset.id}`} onContextMenu={(event) => openMenu(event, assetMenu(asset,owner.id))}>
            <div className="te-brand-asset-art">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={proxied(asset.previewSrc ?? asset.src)} alt={asset.name} loading="lazy" />
              <button className="te-card-menu" aria-haspopup="menu" aria-label={`Actions for ${asset.name}`} onClick={(event) => openMenu(event, assetMenu(asset,owner.id))}>⋯</button>
            </div>
            <strong title={asset.name}>{asset.favorite ? "★ " : ""}{asset.name}</strong><span>{allKits ? `${owner.name} · ` : ""}{asset.variant && asset.variant !== "universal" ? `${asset.variant} · ` : ""}{asset.kind === "logo" ? "Logo" : "Image"} · {asset.width} × {asset.height}</span>
          </article>)}
        </div>
        {!assetResults.length && <div className="te-brand-assets-empty"><ImageIcon size={32} /><h3>{kit.assets.length ? "No matching assets" : "Keep your brand close"}</h3><p>Upload logos, product images, signatures, or decorative elements to reuse across your designs.</p></div>}
      </section>
    </div>
    {assetEdit && <Modal title="Organize brand asset" onClose={()=>setAssetEdit(null)}><form onSubmit={event=>{event.preventDefault();if(!canEdit)return;try{const accepted=onChange(current=>organizeBrandAsset(current,assetEdit.kitId,assetEdit.assetId,{tags:assetEdit.tags.split(",").map(tag=>tag.trim()).filter(Boolean),favorite:assetEdit.favorite,variant:assetEdit.variant},assetEdit.destination,assetEdit.copy));if(accepted===false){setNotice("This asset could not be saved. Check the workspace save message.");return;}{setAssetEdit(null);setNotice(assetEdit.copy?"Asset copied. Existing designs keep their own artwork.":"Asset updated. Existing designs keep their own artwork.");}}catch(error){setNotice(error instanceof Error?error.message:"This asset could not be updated.");}}}>
      {notice&&<p role="status">{notice}</p>}
      <label className="te-field">Tags<input value={assetEdit.tags} maxLength={800} onChange={event=>setAssetEdit({...assetEdit,tags:event.target.value})}/></label>
      <label className="te-field">Logo variant<select value={assetEdit.variant} onChange={event=>setAssetEdit({...assetEdit,variant:event.target.value as typeof assetEdit.variant})}><option value="universal">Universal</option><option value="light">For light backgrounds</option><option value="dark">For dark backgrounds</option></select></label>
      <label className="te-field">Destination kit<select value={assetEdit.destination} onChange={event=>setAssetEdit({...assetEdit,destination:event.target.value})}>{kits.map(owner=><option key={owner.id} value={owner.id}>{owner.name}</option>)}</select></label>
      <label><input type="checkbox" checked={assetEdit.favorite} onChange={event=>setAssetEdit({...assetEdit,favorite:event.target.checked})}/>Favorite asset</label>
      <label><input type="checkbox" checked={assetEdit.copy} onChange={event=>setAssetEdit({...assetEdit,copy:event.target.checked})}/>Create an independent copy</label>
      <div className="te-modal-actions"><button type="button" className="te-button" onClick={()=>setAssetEdit(null)}>Cancel</button><button className="te-button te-primary" disabled={!canEdit}>Save asset</button></div>
    </form></Modal>}
    {nameDialog && <Modal title={nameDialog.kind === "new" ? "Create a brand kit" : nameDialog.kind === "kit" ? "Rename brand kit" : "Rename asset"} onClose={() => setNameDialog(null)}>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (!latest.current.canEdit || !nameDialog.name.trim()) return;
        const name = nameDialog.name.trim();
        let accepted: boolean | void;
        if (nameDialog.kind === "new") {
          const next = createBrandKit(name);
          accepted = onChange((current) => {
            if (libraryBrandKits(current).length >= 20) throw new Error("Your workspace has reached its 20-brand-kit limit.");
            return withBrandKits(current, [...libraryBrandKits(current), next], next.id);
          });
        } else if (nameDialog.kind === "kit") accepted = updateKit(nameDialog.kitId!, (item) => ({ ...item, name }));
        else accepted = updateKit(nameDialog.kitId!, (item) => ({ ...item, assets: item.assets.map((asset) => asset.id === nameDialog.assetId ? { ...asset, name } : asset) }));
        if (accepted === false) return;
        setNameDialog(null);
      }}><label className="te-field">Name<input autoFocus required maxLength={nameDialog.kind === "asset" ? 200 : 100} value={nameDialog.name} onChange={(event) => setNameDialog({ ...nameDialog, name: event.target.value })} /></label><div className="te-modal-actions"><button type="button" className="te-button" onClick={() => setNameDialog(null)}>Cancel</button><button className="te-button te-primary" disabled={!canEdit || !nameDialog.name.trim()}>{nameDialog.kind === "new" ? "Create kit" : "Save name"}</button></div></form>
    </Modal>}
    {remove && <Modal title={remove.kind === "kit" ? "Delete brand kit?" : "Delete brand asset?"} onClose={() => setRemove(null)}>
      <p>“{remove.name}” will be removed from your brand library. Existing designs keep their own copies.</p>
      <div className="te-modal-actions"><button className="te-button" onClick={() => setRemove(null)}>Cancel</button><button className="te-button te-primary" disabled={!canEdit} onClick={() => {
        if (!latest.current.canEdit) return;
        const accepted = remove.kind === "kit" ? onChange((current) => {
          const all = libraryBrandKits(current);
          if (all.length <= 1) return current;
          const remaining = all.filter((item) => item.id !== remove.kitId);
          return withBrandKits(current, remaining, current.activeBrandKitId === remove.kitId ? remaining[0].id : current.activeBrandKitId);
        }) : updateKit(remove.kitId, (item) => ({ ...item, assets: item.assets.filter((asset) => asset.id !== remove.assetId) }));
        if (accepted === false) return;
        setRemove(null);
      }}><TrashIcon />Delete</button></div>
    </Modal>}
  </div>;
}
