# Unpublished draft: support and privacy

This note is for operator review. It is not a published support page, privacy policy, or terms page. Do not put it on the site, and do not invent URLs for it.

## What the tool receives

`compare_page_observations` receives the JSON object the caller posts: two observations and a field list. The comparison runs on that object and returns a report. `charged` is false because this operation does not take payment.

## What this profile does not do

It does not fetch URLs, extract a remote page, schedule a later observation, read a filesystem path, or accept a payment. It does not create an account. It does not infer who the caller is from the user-agent string.

It reuses the existing commerce journal. A comparison, refusal, or aborted transmission on this profile can record one outcome for route `/mcp/page-change`. The record does not include the posted page, a secret, or a claim about customers or revenue. Those rows are not added to paid `POST /mcp` or to the catalog tool `page_change`. The HTTP route's 12-per-minute limit is not applied here. Source and owner checks stay separate from outside use.

## Retention

The profile is stateless. It does not add a store for the posted observations. Host and proxy logs that already exist for the merchant are unchanged by this draft.

## Before any public URL

A person has to review this note and decide the real support, privacy, and terms text. Those pages, and their URLs, are separate from this file.
