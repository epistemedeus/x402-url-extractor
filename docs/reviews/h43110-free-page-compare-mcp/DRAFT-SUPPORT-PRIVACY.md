# Unpublished draft: support and privacy

This note is for operator review. It is not a published support page, privacy policy, or terms page. Do not put it on the site, and do not invent URLs for it.

## What the tool receives

`compare_page_observations` receives the JSON object the caller posts: two observations and a field list. The comparison runs on that object and returns a report. `charged` is false because this operation does not take payment.

## What this profile does not do

It does not fetch URLs, extract a remote page, schedule a later observation, read a filesystem path, or accept a payment. It does not create an account. It does not infer who the caller is from the user-agent string. It does not write a new measurement record. The existing page-change observer is only for `POST /recipes/page-change` and the paid `POST /mcp` tool named `page_change`.

## Retention

The profile is stateless. It does not add a store for the posted observations. Host and proxy logs that already exist for the merchant are unchanged by this draft.

## Before any public URL

A person has to review this note and decide the real support, privacy, and terms text. Those pages, and their URLs, are separate from this file.
