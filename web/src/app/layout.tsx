import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CIMScan — Automated CIM Diligence",
  description: "Thesis pillars. Operational narrative. Diligence plan. Just hit send. CIMScan extracts and pressure tests a CIM's operational claims — delivering structured diligence in minutes.",
  openGraph: {
    title: "CIMScan — Automated CIM Diligence",
    description: "Thesis pillars. Operational narrative. Diligence plan. Just hit send.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
