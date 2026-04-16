'use client';
import { useRef, useCallback, useImperativeHandle, forwardRef } from 'react';

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: string;
}

export interface RichTextEditorHandle {
  insertText: (text: string) => void;
}

export const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(
  function RichTextEditor({ value, onChange, placeholder, minHeight = '200px' }, ref) {
    const editorRef = useRef<HTMLDivElement>(null);

    function exec(cmd: string, val?: string) {
      document.execCommand(cmd, false, val);
      if (editorRef.current) onChange(editorRef.current.innerHTML);
    }

    const insertText = useCallback((text: string) => {
      const el = editorRef.current;
      if (!el) return;
      el.focus();
      document.execCommand('insertText', false, text);
      onChange(el.innerHTML);
    }, [onChange]);

    useImperativeHandle(ref, () => ({ insertText }), [insertText]);

    return (
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        {/* Toolbar */}
        <div className="flex flex-wrap gap-1 p-2 border-b border-gray-200 bg-gray-50">
          <ToolBtn onClick={() => exec('bold')} title="Bold"><b>B</b></ToolBtn>
          <ToolBtn onClick={() => exec('italic')} title="Italic"><i>I</i></ToolBtn>
          <ToolBtn onClick={() => exec('underline')} title="Underline"><u>U</u></ToolBtn>
          <span className="w-px h-6 bg-gray-300 mx-1" />
          <ToolBtn onClick={() => exec('formatBlock', '<h2>')} title="Heading">H2</ToolBtn>
          <ToolBtn onClick={() => exec('formatBlock', '<h3>')} title="Subheading">H3</ToolBtn>
          <ToolBtn onClick={() => exec('formatBlock', '<p>')} title="Paragraph">P</ToolBtn>
          <span className="w-px h-6 bg-gray-300 mx-1" />
          <ToolBtn onClick={() => exec('insertUnorderedList')} title="Bullet list">&#8226; List</ToolBtn>
          <ToolBtn onClick={() => exec('insertOrderedList')} title="Numbered list">1. List</ToolBtn>
          <span className="w-px h-6 bg-gray-300 mx-1" />
          <ToolBtn onClick={() => { const url = prompt('Link URL:'); if (url) exec('createLink', url); }} title="Link">Link</ToolBtn>
          <ToolBtn onClick={() => exec('removeFormat')} title="Clear formatting">Clear</ToolBtn>
        </div>
        {/* Editor */}
        <div
          ref={editorRef}
          contentEditable
          className="p-4 focus:outline-none prose prose-sm max-w-none"
          style={{ minHeight }}
          dangerouslySetInnerHTML={{ __html: value }}
          onInput={() => { if (editorRef.current) onChange(editorRef.current.innerHTML); }}
          data-placeholder={placeholder}
        />
      </div>
    );
  }
);

function ToolBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={title}
      className="px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200 rounded transition-colors">
      {children}
    </button>
  );
}
