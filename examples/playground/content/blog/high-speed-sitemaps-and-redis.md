---
title: "Zero-Cost Dynamic Sitemaps with Two-Tier Caching and ETags"
date: "2026-10-18"
author: "MURAGEH"
description: "How to merge dynamic database entities like product catalogs and platform landing pages with universal markdown and headless CMS without breaking the bank."
category: "Performance"
tags: ["sitemaps", "seo", "redis", "fastify", "performance"]
priority: 0.8
changefreq: "daily"
featuredImage: "https://murageh.co.ke/assets/sitemap-cache-diagram.png"
imageTitle: "Two-Tier Sitemap Caching Architecture"
---

# Zero-Cost Dynamic Sitemaps with Two-Tier Caching

Sitemaps are deceptively expensive in high-traffic applications:
1. Search crawlers (Googlebot, Bingbot) crawl them repeatedly.
2. In monolithic designs, generating 10,000 URLs queries the database repeatedly.
3. Content changes infrequently, but un-cached requests burn server CPU and database connections.

By pre-rendering string XML chunks in Redis and returning HTTP 304 Not Modified when ETags match, sitemap response latency drops from 40ms to under 0.2ms.
