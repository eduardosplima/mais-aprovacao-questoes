"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import Bold from "@tiptap/extension-bold";
import Italic from "@tiptap/extension-italic";
import Underline from "@tiptap/extension-underline";
import Heading from "@tiptap/extension-heading";
import { BulletList, OrderedList, ListItem } from "@tiptap/extension-list";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import History from "@tiptap/extension-history";
import { useEffect } from "react";
import { BarraFerramentas } from "./BarraFerramentas";

/**
 * O HTML que sai daqui é uma **sugestão**, não uma garantia. A sanitização
 * acontece no servidor, na escrita (api/src/lib/sanitizeHtml.ts, com
 * HTMLRewriter). Este editor existe para a operação escrever bem, não para
 * proteger nada — a allowlist abaixo casa com a do servidor só para evitar que
 * o operador digite algo que some ao salvar.
 */
export function Editor({
  valor,
  aoMudar,
  rotulo,
  comTabela = false,
  minAltura = 180,
}: {
  valor: string;
  aoMudar: (html: string) => void;
  rotulo: string;
  comTabela?: boolean;
  minAltura?: number;
}) {
  const editor = useEditor({
    // Sem SSR: o Next não renderiza nada disto no servidor porque o app é
    // export estático, mas o TipTap avisa se não for explícito.
    immediatelyRender: false,
    extensions: [
      Document,
      Paragraph,
      Text,
      Bold,
      Italic,
      Underline,
      Heading.configure({ levels: [2, 3] }),
      BulletList,
      OrderedList,
      ListItem,
      Link.configure({ openOnClick: false, autolink: false }),
      Image,
      History,
      ...(comTabela
        ? [Table.configure({ resizable: false }), TableRow, TableCell, TableHeader]
        : []),
    ],
    content: valor,
    onUpdate: ({ editor: e }) => aoMudar(e.getHTML()),
    editorProps: {
      attributes: {
        class: "prosa outline-none px-4 py-3",
        style: `min-height:${minAltura}px`,
        "aria-label": rotulo,
      },
    },
  });

  // Carregar uma questão existente troca o `valor` por fora; sem isto o editor
  // continuaria mostrando o conteúdo anterior.
  useEffect(() => {
    if (editor && valor !== editor.getHTML()) {
      editor.commands.setContent(valor, { emitUpdate: false });
    }
  }, [valor, editor]);

  return (
    <div className="border border-borda-2 rounded-btn bg-white overflow-hidden focus-within:border-roxo transition-colors">
      <BarraFerramentas editor={editor} comTabela={comTabela} />
      <EditorContent editor={editor} />
    </div>
  );
}
