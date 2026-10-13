import type {CanvasElement,CanvasScene,ShapeImageFill} from "./model";
const photo = <T extends ShapeImageFill>(value:T):T => value.previewSrc?{...value,src:value.previewSrc}:value;
/** Rendering-only projection. Never commit this scene or use it for an export. */
export function elementWithPreviewAsset(element:CanvasElement):CanvasElement {
  if(element.type==="image") return element.previewSrc?{...element,src:element.previewSrc}:element;
  if(element.type==="shape") return element.imageFill?.previewSrc?{...element,imageFill:photo(element.imageFill)}:element;
  return {...element,...(element.textureFill?{textureFill:photo(element.textureFill)}:{}),...(element.wordTextures?{wordTextures:element.wordTextures.map(photo)}:{})};
}
export function sceneWithPreviewAssets(scene:CanvasScene):CanvasScene {return {...scene,elements:scene.elements.map(elementWithPreviewAsset)};}
