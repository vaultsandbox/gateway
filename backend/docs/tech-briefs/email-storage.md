# Email Storage Architecture

## Overview

Email storage uses a two-tier system: `EmailStorageService` manages global memory limits and FIFO eviction, while `InboxStorageService` handles per-inbox email storage.

## Flow

```
Incoming Email → EmailStorageService.storeEmail()
                      ↓
              Check memory limits
              Evict oldest if needed
                      ↓
              InboxStorageService.addEmail()
              (actual storage in inbox Map)
```

## EmailStorageService (`email-storage.service.ts`)

**Purpose**: Global memory management and eviction policy.

- Tracks all emails in insertion order via `emails: EmailTrackingEntry[]`
- Enforces configurable memory limit (`VSB_SMTP_MAX_MEMORY_MB`, default 500MB)
- FIFO eviction: when memory is full, oldest emails are removed first
- Uses tombstone pattern for O(1) deletion (marks entries instead of array splice)
- Hourly compaction removes tombstone metadata
- Optional time-based eviction (`VSB_SMTP_MAX_EMAIL_AGE_SECONDS`)

**Key methods**:
- `storeEmail()` - Stores email, evicts if needed
- `evictIfNeeded()` - Removes oldest emails until space available
- `tombstoneEmail()` - Marks email as evicted, frees memory
- `onEmailDeleted()` / `onInboxDeleted()` - Cleanup callbacks from InboxStorageService

## InboxService (`inbox.service.ts`)

**Purpose**: Inbox lifecycle and email access API.

- Creates/deletes inboxes with TTL expiration
- Delegates storage operations to `InboxStorageService`
- Serializes encrypted payloads (Uint8Array → Base64URL) for API responses
- Validates email addresses, domains, KEM public keys
- Derives inbox hash from client's ML-KEM public key

**Key methods**:
- `createInbox()` - Creates inbox with client KEM key
- `getEmails()` - Returns metadata list (serialized)
- `getEmail()` - Returns parsed email content (serialized)
- `getRawEmail()` - Returns raw email content (serialized)

## Memory Model

```
EmailStorageService                 InboxStorageService
┌─────────────────────┐            ┌─────────────────────┐
│ emails[] (tracking) │            │ inboxes Map         │
│ - emailId           │───────────▶│   └─ emails Map     │
│ - inboxEmail        │            │       └─ encrypted  │
│ - size              │            │          payloads   │
│ - receivedAt        │            └─────────────────────┘
│ - isTombstone       │
└─────────────────────┘
     │
     ▼
currentMemoryUsage (sum of all email sizes)
```

Eviction removes from both: tracking array (tombstone) and inbox Map (full delete).

---

## References

**[1] Tombstone Pattern**: Instead of removing elements from an array (O(n) due to index shifting), entries are marked as "deleted" (`isTombstone: true`) and skipped during iteration. This achieves O(1) deletion at the cost of memory overhead from retained metadata. Periodic compaction reclaims this space by filtering out tombstones.
