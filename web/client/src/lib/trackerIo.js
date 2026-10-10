// Tracker import (Teal / Huntr / Simplify / any spreadsheet CSV) and exports (tracker CSV,
// dated work-search log). Parsing runs on the device; imported rows become encrypted records.
import { parseTrackerCsv } from '@shared/csvImport.js';
import { trackerImportRecords, workLogRows, trackerRows, toCsv } from '@shared/campaignRules.js';
import { newId } from '@shared/vaultCrypto.js';
import { saveBytes } from './bridge.js';

const MAX_CSV = 5 * 1024 * 1024;

export async function readCsvFile(file) {
  if (!file) throw new Error('Choose a CSV file.');
  if (file.size > MAX_CSV) throw new Error('That CSV is larger than 5 MB.');
  return file.text();
}

/** Imports tracker rows; returns { added, skipped, columns }. */
export async function importTracker(app, text, source = 'CSV') {
  const { items, columns } = parseTrackerCsv(text);
  if (!items.length) throw new Error('No applications found in that CSV.');
  const { records, skipped } = trackerImportRecords(items.slice(0, 2000), app.sync.list('applications'), source.replace(/\.csv$/i, '').slice(0, 40), newId);
  for (const r of records) await app.put('applications', r.id, r);
  return { added: records.length, skipped, columns };
}

const stamp = () => new Date().toISOString().slice(0, 10);
const csvBytes = (rows) => new TextEncoder().encode(`﻿${toCsv(rows)}`);

export async function exportWorkLog(app, from) {
  const { rows, count } = workLogRows(app.applications, from);
  await saveBytes(`work-search-log-${stamp()}.csv`, csvBytes(rows), 'text/csv');
  return { count };
}

export async function exportTrackerCsv(app) {
  await saveBytes(`applypilot-applications-${stamp()}.csv`, csvBytes(trackerRows(app.applications)), 'text/csv');
  return { count: app.applications.length };
}
