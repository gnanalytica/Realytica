# Realytica Property Intelligence — source specification

Transcribed from `Realytica_Property_Intelligence.pdf` (v0.1, Product Definition Draft).
This file is the requirements source of truth for the application in this repository.

## Summary

Realytica is an AI-powered Property Intelligence platform designed to help users understand a
property **before** they commit significant money, professional effort, financing, or acquisition
resources.

## Document metadata

| Field | Value |
| --- | --- |
| Version | 0.1 |
| Status | Product Definition Draft |
| Owner | Gnanalytica |
| Product | Realytica |
| Initial markets | India and Netherlands |
| Initial release | Realytica Property Screen |
| Future products | Realytica Diligence, Project Intelligence, Portfolio Intelligence |

## Product vision

Make property decisions clearer, faster and evidence-driven.

**Long-term positioning:** property decision infrastructure.

## Product family

| Product | Question it answers |
| --- | --- |
| Realytica Property Screen | Should I pursue this property? |
| Realytica Diligence | What exactly am I getting into? |
| Realytica Project Intelligence | Does this acquisition or development opportunity make commercial sense? |
| Realytica Portfolio Intelligence | Where are the risks and opportunities across our properties? |

## Product principles

1. Evidence Before Assertion
2. Range Before False Precision
3. Explain the Why
4. Uncertainty Must Be Visible
5. Drive Action

## Target customers

**Primary MVP personas:** Property Investor; Developer / Acquisition Manager;
Property Adviser / Consultant; Valuation Firm.

**Secondary personas:** lenders, NBFCs, banks, family offices, real estate funds,
buyer-side agents, legal diligence firms, project consultants, asset managers.

## Key user jobs

1. Tell me if this property is worth investigating.
2. Tell me what this property is probably worth.
3. Explain why the property is worth that.
4. Tell me what could make this a bad deal.
5. Tell me what documents or information are missing.
6. Tell me whether there is development potential.
7. Tell me what I need to resolve before proceeding.
8. Help me compare several properties.

## MVP scope

property case creation; property identification; document upload; document classification;
OCR/extraction; external property-data retrieval; property snapshot; indicative value range;
multiple value anchors; market comparables; value drivers; material risk flags; planning position;
document completeness; confidence scoring; evidence traceability; recommended actions;
Property Screen report.

## Out of MVP scope

certified valuation; legal title certificate; formal legal opinion; engineering inspection;
bank lending approval; formal mortgage valuation; full project feasibility; portfolio management;
automated purchase recommendation without explanation; nationwide support for every property type.

## Geography and rollout phases

**Architecture:** Global Core + Country Pack + State / Municipality Pack.

| Phase | Content |
| --- | --- |
| Phase 1 (MVP) | India, one state/metro, one property type, professional users first |
| Phase 2 | second property type, second geography, comparison, collaboration, deeper diligence, professional review, additional data integrations |
| Phase 3 | Netherlands Country Pack |
| Phase 4 | Project Intelligence |
| Phase 5 | Portfolio Intelligence |

## North star

> Realytica succeeds when the customer can go from "I have this property. I don't know what to make
> of it." to "I understand what it is likely worth, why, what I need to worry about, what evidence
> supports that conclusion, and exactly what I need to do next."
