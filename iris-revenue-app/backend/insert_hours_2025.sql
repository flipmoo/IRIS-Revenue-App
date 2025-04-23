-- Script om handmatig uren toe te voegen voor 2025
-- Eerst controleren of er projecten en medewerkers zijn
SELECT COUNT(*) FROM projects;
SELECT COUNT(*) FROM employees;

-- Als er projecten en medewerkers zijn, kunnen we uren toevoegen
-- We voegen 10 uren toe voor 2025
INSERT INTO hours (id, amount, amountwritten, date, description, employee_id, offerprojectbase_id, offerprojectbase_type)
VALUES 
(1000001, 8.0, '8.0', '2025-01-01', 'Handmatig toegevoegd uur 1', 1, 1, 'project'),
(1000002, 8.0, '8.0', '2025-01-02', 'Handmatig toegevoegd uur 2', 1, 1, 'project'),
(1000003, 8.0, '8.0', '2025-01-03', 'Handmatig toegevoegd uur 3', 1, 1, 'project'),
(1000004, 8.0, '8.0', '2025-01-04', 'Handmatig toegevoegd uur 4', 1, 1, 'project'),
(1000005, 8.0, '8.0', '2025-01-05', 'Handmatig toegevoegd uur 5', 1, 1, 'project'),
(1000006, 8.0, '8.0', '2025-01-06', 'Handmatig toegevoegd uur 6', 1, 1, 'project'),
(1000007, 8.0, '8.0', '2025-01-07', 'Handmatig toegevoegd uur 7', 1, 1, 'project'),
(1000008, 8.0, '8.0', '2025-01-08', 'Handmatig toegevoegd uur 8', 1, 1, 'project'),
(1000009, 8.0, '8.0', '2025-01-09', 'Handmatig toegevoegd uur 9', 1, 1, 'project'),
(1000010, 8.0, '8.0', '2025-01-10', 'Handmatig toegevoegd uur 10', 1, 1, 'project');

-- Nu dupliceren we deze uren 1000 keer om 10.000 uren te krijgen
-- We maken een tijdelijke tabel met de 10 uren
CREATE TEMPORARY TABLE temp_hours AS
SELECT * FROM hours WHERE id BETWEEN 1000001 AND 1000010;

-- We dupliceren de uren 999 keer
-- Elke keer verhogen we de ID's met 10
PRAGMA recursive_triggers = ON;

WITH RECURSIVE
  cnt(x) AS (
     SELECT 1
     UNION ALL
     SELECT x+1 FROM cnt
      LIMIT 999
  )
INSERT INTO hours
SELECT id + (x * 10), amount, amountwritten, date, description, employee_id, offerprojectbase_id, offerprojectbase_type, offer_project_line_id, offerprojectline_id, project_id
FROM temp_hours, cnt;

-- Controleren hoeveel uren er nu zijn voor 2025
SELECT COUNT(*) AS total_hours, SUM(CAST(amount AS REAL)) AS total_amount FROM hours WHERE SUBSTR(date, 1, 4) = '2025';

-- Tijdelijke tabel opruimen
DROP TABLE temp_hours;
