import { SheetsIngestionService } from '../integrations/sheets/SheetsIngestionService.js';

SheetsIngestionService.syncAll()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
