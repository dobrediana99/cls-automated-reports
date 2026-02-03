// Builds the same employee-by-department structure as frontend DEPARTMENTS from src/config/org.js.
import { ORG, DEPARTMENTS } from '../../src/config/org.js';

const DEP_KEY = {
  [DEPARTMENTS.MANAGEMENT]: 'management',
  [DEPARTMENTS.SALES]: 'sales',
  [DEPARTMENTS.OPERATIONS]: 'operational',
};

const ID_OFFSET = { management: 301, sales: 201, operational: 103 };

/**
 * @returns {{ management: Array<{id, name, mondayUserId, target}>, sales: Array<...>, operational: Array<...> }}
 */
export function getEmployeesByDepartment() {
  const byDept = { management: [], sales: [], operational: [] };
  const index = { management: 0, sales: 0, operational: 0 };

  for (const person of ORG) {
    if (!person.isActive) continue;
    const key = DEP_KEY[person.department];
    if (!key) continue;
    const id = ID_OFFSET[key] + index[key];
    index[key]++;
    byDept[key].push({
      id,
      name: person.name,
      mondayUserId: person.mondayUserId,
      target: Number(person.target) || 0,
    });
  }

  return byDept;
}
