import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GPT Search Personal",
  description: "Search and research assistant UI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body
        className="min-h-full flex flex-col"
        style={{ isolation: "isolate" }}
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
