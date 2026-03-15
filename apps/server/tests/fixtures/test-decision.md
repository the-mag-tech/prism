# Why We Chose SQLite for Prism

Date: 2024-03-15

## Background

When designing the Prism server, we needed a database that could:
1. Work locally without any external dependencies
2. Be simple to deploy and backup
3. Support full-text search natively

## Decision

After evaluating PostgreSQL, MySQL, and SQLite, we chose **SQLite** because:

### 1. Local-First Philosophy
Our core principle is "your data stays on your machine". SQLite is a file-based database that doesn't require a server process.

### 2. Zero Configuration
Users can start using Prism immediately without setting up a database server. Just download and run.

### 3. Built-in FTS5
SQLite's FTS5 extension provides excellent full-text search capabilities, which is crucial for our "recall" feature.

### 4. Portable
The entire database is a single file that can be easily backed up, copied, or moved.

## Trade-offs Accepted

- No concurrent write access (acceptable for single-user use)
- Limited scalability (acceptable for personal data)
- No built-in vector search (will use external library if needed)

## Conclusion

SQLite perfectly aligns with our local-first, privacy-focused vision. The simplicity it provides far outweighs the limitations for our use case.

