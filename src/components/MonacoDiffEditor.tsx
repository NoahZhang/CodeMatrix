import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';
import { useStore } from '../store/store';
import { monacoThemeName } from '../lib/monaco-theme';

interface MonacoDiffEditorProps {
  oldContent: string;
  newContent: string;
  language: string;
  sideBySide: boolean;
}

export function MonacoDiffEditor(props: MonacoDiffEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | undefined>(undefined);
  const originalModelRef = useRef<monaco.editor.ITextModel | undefined>(undefined);
  const modifiedModelRef = useRef<monaco.editor.ITextModel | undefined>(undefined);

  const themePreset = useStore((s) => s.themePreset);

  // Mount / unmount the diff editor
  useEffect(() => {
    if (!containerRef.current) return;

    const editor = monaco.editor.createDiffEditor(containerRef.current, {
      automaticLayout: true,
      readOnly: true,
      renderSideBySide: props.sideBySide,
      theme: monacoThemeName(themePreset),
      fontSize: 12,
      fontFamily: "'JetBrains Mono', monospace",
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderOverviewRuler: false,
      stickyScroll: { enabled: false },
      hideUnchangedRegions: { enabled: true },
    });
    editorRef.current = editor;

    const originalModel = monaco.editor.createModel(props.oldContent, props.language);
    const modifiedModel = monaco.editor.createModel(props.newContent, props.language);
    originalModelRef.current = originalModel;
    modifiedModelRef.current = modifiedModel;
    editor.setModel({ original: originalModel, modified: modifiedModel });

    editor.onDidUpdateDiff(() => {
      const changes = editor.getLineChanges();
      if (changes && changes.length > 0) {
        const line = changes[0].modifiedStartLineNumber;
        editor.getModifiedEditor().revealLineInCenter(line);
      }
    });

    // Make the entire hidden-lines bar clickable (Monaco only wires a tiny icon by default)
    const container = containerRef.current;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const center = target.closest('.diff-hidden-lines .center');
      if (!center) return;
      const link = center.querySelector<HTMLElement>('a[role="button"]');
      if (link && !link.contains(target)) link.click();
    };
    container.addEventListener('click', handleClick);

    return () => {
      container.removeEventListener('click', handleClick);
      editor.dispose();
      originalModel.dispose();
      modifiedModel.dispose();
      editorRef.current = undefined;
      originalModelRef.current = undefined;
      modifiedModelRef.current = undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync language
  useEffect(() => {
    if (originalModelRef.current) monaco.editor.setModelLanguage(originalModelRef.current, props.language);
    if (modifiedModelRef.current) monaco.editor.setModelLanguage(modifiedModelRef.current, props.language);
  }, [props.language]);

  // Sync old content
  useEffect(() => {
    if (originalModelRef.current && originalModelRef.current.getValue() !== props.oldContent) {
      originalModelRef.current.setValue(props.oldContent);
    }
  }, [props.oldContent]);

  // Sync new content
  useEffect(() => {
    if (modifiedModelRef.current && modifiedModelRef.current.getValue() !== props.newContent) {
      modifiedModelRef.current.setValue(props.newContent);
    }
  }, [props.newContent]);

  // Sync sideBySide option
  useEffect(() => {
    editorRef.current?.updateOptions({ renderSideBySide: props.sideBySide });
  }, [props.sideBySide]);

  // Sync theme
  useEffect(() => {
    monaco.editor.setTheme(monacoThemeName(themePreset));
  }, [themePreset]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
