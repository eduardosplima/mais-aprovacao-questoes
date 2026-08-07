"use client";

import type { Editor as EditorTipTap } from "@tiptap/react";
import { UploadImagem } from "./UploadImagem";

function Bot({
  ativo,
  aoClicar,
  titulo,
  children,
}: {
  ativo?: boolean;
  aoClicar: () => void;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={titulo}
      aria-label={titulo}
      aria-pressed={ativo}
      onClick={aoClicar}
      className={`h-9 min-w-9 px-2 rounded-lg text-[13px] font-bold transition-colors ${
        ativo ? "bg-roxo-bg text-roxo" : "text-txt-2 hover:bg-roxo-bg/50"
      }`}
    >
      {children}
    </button>
  );
}

export function BarraFerramentas({
  editor,
  comTabela,
}: {
  editor: EditorTipTap | null;
  comTabela: boolean;
}) {
  if (!editor) return null;

  return (
    <div className="flex flex-wrap items-center gap-1 px-2 py-1.5 border-b border-borda bg-pagina">
      <Bot
        titulo="Negrito"
        ativo={editor.isActive("bold")}
        aoClicar={() => editor.chain().focus().toggleBold().run()}
      >
        <strong>N</strong>
      </Bot>
      <Bot
        titulo="Itálico"
        ativo={editor.isActive("italic")}
        aoClicar={() => editor.chain().focus().toggleItalic().run()}
      >
        <em>I</em>
      </Bot>
      <Bot
        titulo="Sublinhado"
        ativo={editor.isActive("underline")}
        aoClicar={() => editor.chain().focus().toggleUnderline().run()}
      >
        <u>S</u>
      </Bot>

      <span className="w-px h-5 bg-borda-2 mx-1" />

      <Bot
        titulo="Título"
        ativo={editor.isActive("heading", { level: 2 })}
        aoClicar={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        H2
      </Bot>
      <Bot
        titulo="Subtítulo"
        ativo={editor.isActive("heading", { level: 3 })}
        aoClicar={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        H3
      </Bot>
      <Bot
        titulo="Lista"
        ativo={editor.isActive("bulletList")}
        aoClicar={() => editor.chain().focus().toggleBulletList().run()}
      >
        •
      </Bot>
      <Bot
        titulo="Lista numerada"
        ativo={editor.isActive("orderedList")}
        aoClicar={() => editor.chain().focus().toggleOrderedList().run()}
      >
        1.
      </Bot>

      <span className="w-px h-5 bg-borda-2 mx-1" />

      <Bot
        titulo="Link"
        ativo={editor.isActive("link")}
        aoClicar={() => {
          if (editor.isActive("link")) {
            editor.chain().focus().unsetLink().run();
            return;
          }
          const url = window.prompt("Endereço do link (http ou https)");
          if (!url) return;
          // O servidor descarta href com esquema fora da allowlist; barrar aqui
          // evita o link sumir em silêncio depois de salvar.
          if (!/^https?:\/\//i.test(url)) {
            window.alert("Use um endereço começando com http:// ou https://");
            return;
          }
          editor.chain().focus().setLink({ href: url }).run();
        }}
      >
        🔗
      </Bot>

      <UploadImagem
        aoEnviar={(url) => editor.chain().focus().setImage({ src: url }).run()}
      />

      {comTabela && (
        <>
          <span className="w-px h-5 bg-borda-2 mx-1" />
          <Bot
            titulo="Inserir tabela"
            aoClicar={() =>
              editor
                .chain()
                .focus()
                .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                .run()
            }
          >
            ▦
          </Bot>
          <Bot
            titulo="Adicionar linha"
            aoClicar={() => editor.chain().focus().addRowAfter().run()}
          >
            +L
          </Bot>
          <Bot
            titulo="Adicionar coluna"
            aoClicar={() => editor.chain().focus().addColumnAfter().run()}
          >
            +C
          </Bot>
          <Bot
            titulo="Remover tabela"
            aoClicar={() => editor.chain().focus().deleteTable().run()}
          >
            ▦✕
          </Bot>
        </>
      )}

      <span className="ml-auto flex gap-1">
        <Bot titulo="Desfazer" aoClicar={() => editor.chain().focus().undo().run()}>
          ↶
        </Bot>
        <Bot titulo="Refazer" aoClicar={() => editor.chain().focus().redo().run()}>
          ↷
        </Bot>
      </span>
    </div>
  );
}
