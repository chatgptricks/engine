"use client";

import { useEffect, useRef, useState } from "react";
import { useEngine } from "@/lib/engine/store";
import type { StoryImage } from "@/lib/engine/types";
import {
  ArrowRightIcon,
  CloseIcon,
  ImageIcon,
  PaperclipIcon,
  SearchIcon,
} from "./icons";

/**
 * Create — a frosted composer modeled on the Claude chat input, centered on a
 * dark screen with no outer frame. Type what to research, attach reference
 * pictures and files (shown as thumbnails above the text), and start. It makes
 * a new story in "researching" status for the future research engine.
 */
function fileToImage(file: File): Promise<StoryImage> {
  return new Promise((resolve) => {
    const id = `cimg_${Date.now()}_${Math.round(Math.random() * 1e6)}`;
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      const probe = new window.Image();
      const finish = (w: number, h: number) =>
        resolve({
          id,
          url,
          source: "cosmos_manual",
          kind: "real_subject",
          directive: file.name,
          width: w,
          height: h,
          rightsNote: "Added by hand — confirm rights before posting.",
          cosmosManual: true,
        });
      probe.onload = () => finish(probe.naturalWidth, probe.naturalHeight);
      probe.onerror = () => finish(1080, 1080);
      probe.src = url;
    };
    reader.readAsDataURL(file);
  });
}

export function CreateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (storyId: string) => void;
}) {
  const { createStory } = useEngine();
  const [prompt, setPrompt] = useState("");
  const [images, setImages] = useState<StoryImage[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const imgInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    taRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [prompt]);

  async function addImages(arr: File[]) {
    if (!arr.length) return;
    const converted = await Promise.all(arr.map(fileToImage));
    setImages((prev) => [...prev, ...converted]);
  }

  function addFiles(arr: File[]) {
    if (!arr.length) return;
    setFiles((prev) => [...prev, ...arr.map((f) => f.name)]);
  }

  // Drag-and-drop onto the composer: images become thumbnails, others chips.
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer?.files ?? []);
    addImages(dropped.filter((f) => f.type.startsWith("image/")));
    addFiles(dropped.filter((f) => !f.type.startsWith("image/")));
  }

  const canSubmit = prompt.trim().length > 0 || images.length > 0;

  function submit() {
    if (!canSubmit) return;
    const id = createStory({ prompt: prompt.trim(), images, attachments: files });
    onCreated(id);
  }

  return (
    <div className="gf-modal-backdrop" onClick={onClose}>
      <div
        className="gf-create"
        role="dialog"
        aria-modal="true"
        aria-label="Create research"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="gf-create-head">
          <span className="gf-create-title">
            <SearchIcon size={15} /> New research
          </span>
          <button className="gf-modal-close" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        <div
          className={`gf-composer${dragOver ? " is-dragover" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          {(images.length > 0 || files.length > 0) && (
            <div className="gf-attach-row">
              {images.map((img) => (
                <span className="gf-attach-thumb" key={img.id} title={img.directive}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt="" />
                  <button
                    className="gf-attach-x"
                    aria-label="Remove image"
                    onClick={() =>
                      setImages((prev) => prev.filter((i) => i.id !== img.id))
                    }
                  >
                    <CloseIcon size={11} />
                  </button>
                </span>
              ))}
              {files.map((name, i) => (
                <span className="gf-attach-chip" key={`${name}-${i}`} title={name}>
                  <PaperclipIcon size={12} />
                  <span className="gf-attach-name">{name}</span>
                  <button
                    className="gf-attach-x gf-attach-x-chip"
                    aria-label="Remove file"
                    onClick={() =>
                      setFiles((prev) => prev.filter((_, idx) => idx !== i))
                    }
                  >
                    <CloseIcon size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <textarea
            ref={taRef}
            className="gf-composer-input"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="What should we research? Describe the story, subject, or angle you want explored…"
          />

          <div className="gf-composer-foot">
            <div className="gf-composer-tools">
              <button
                className="gf-tool-btn"
                onClick={() => imgInput.current?.click()}
                aria-label="Add pictures"
              >
                <ImageIcon />
                Pictures
              </button>
              <button
                className="gf-tool-btn"
                onClick={() => fileInput.current?.click()}
                aria-label="Add files"
              >
                <PaperclipIcon />
                Files
              </button>
            </div>
            <button
              className="gf-send-btn"
              onClick={submit}
              disabled={!canSubmit}
              aria-label="Start research"
            >
              <ArrowRightIcon size={17} />
            </button>
          </div>
        </div>

        <p className="gf-modal-hint">
          Starts a new story in <b>Researching</b>. Drop files anywhere on the box. ⌘↵ to start.
        </p>

        <input
          ref={imgInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const arr = e.target.files ? Array.from(e.target.files) : [];
            e.target.value = "";
            addImages(arr);
          }}
        />
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const arr = e.target.files ? Array.from(e.target.files) : [];
            e.target.value = "";
            addFiles(arr);
          }}
        />
      </div>
    </div>
  );
}
