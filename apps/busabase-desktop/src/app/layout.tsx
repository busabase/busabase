import type { Metadata } from "next";
import type { ReactNode } from "react";
import "kui/styles.css";
import "./styles.css";

export const metadata: Metadata = {
  title: "Busabase Desktop",
  description: "Private local-first Busabase knowledge base desktop shell.",
};

interface Props {
  children: ReactNode;
}

export default function RootLayout({ children }: Props) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
