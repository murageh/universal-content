---
title: "Announcing @crispice/universal-content: One Engine for Next.js, Fastify & Vite"
date: "2026-10-18"
author: "MURAGEH"
description: "Why we built a universal content engine that shares markdown and headless WordPress across frontend and backend."
category: "Engineering"
tags: ["fastify", "nextjs", "vite", "redis", "seo"]
priority: 0.9
changefreq: "weekly"
featuredImage: "https://murageh.co.ke/assets/universal-content-banner.png"
imageTitle: "Universal Content Architecture Diagram"
---

# Announcing @crispice/universal-content

Modern web development has fractured content delivery:
- **Next.js** wants App Router server components.
- **Fastify** wants high-throughput JSON and XML streaming.
- **Vite** wants client-side bundler plugins with HMR.

Instead of duplicating parsers and content models across repositories, `@crispice/universal-content` unifies Markdown and Headless WordPress into a single pipeline with two-tier caching (L1 in-memory LRU + L2 persistent Redis).
