import fs from 'fs';
import path from 'path';

const PASSED_AUDIT_JSON = path.join(__dirname, '../../data/passed_audit.json');
const FAILED_AUDIT_JSON = path.join(__dirname, '../../data/failed_audit.json');
const ACTIVE_DODO_EGGS_JSON = path.join(__dirname, '../../data/active_dodo_eggs.json');

/**
 * For pairs that pass the Audit
 */
const saveAuditedDodoEgg = (passed, dodoEgg) => {
  try {
    // Read existing data
    let existingData = [];
    try {
      const fileContent = fs.readFileSync(passed ? PASSED_AUDIT_JSON : FAILED_AUDIT_JSON, 'utf8');
      existingData = JSON.parse(fileContent);
    } catch (error) {
      // If file doesn't exist or is empty, start with empty array
      existingData = [];
    }

    // Add new dodoEgg to array
    existingData.push(dodoEgg);

    // Write the entire array back to file
    fs.writeFileSync(
      passed ? PASSED_AUDIT_JSON : FAILED_AUDIT_JSON,
      JSON.stringify(existingData, null, 2),
      'utf8'
    );
  } catch (error) {
    console.error('Error saving to passed_audit.json:', error);
  }
};
