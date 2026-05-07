import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Beacon Search",
  description: "Beacon Search research assistant UI",
  icons: {
    icon: "/lighthouse.svg",
    shortcut: "/lighthouse.svg",
    apple: "/lighthouse.svg",
  },
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
