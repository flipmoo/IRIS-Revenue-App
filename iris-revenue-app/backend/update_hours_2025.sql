-- Script om uren voor 2025 te koppelen aan projecten
-- Eerst controleren of er projecten zijn
SELECT COUNT(*) FROM projects;

-- Een willekeurig project ID ophalen
SELECT id FROM projects LIMIT 1;

-- Alle uren voor 2025 updaten om ze te koppelen aan het eerste project
UPDATE hours 
SET offerprojectbase_id = (SELECT id FROM projects LIMIT 1),
    offerprojectbase_type = 'project'
WHERE SUBSTR(date, 1, 4) = '2025' AND offerprojectbase_id IS NULL;

-- Controleren hoeveel uren er nu gekoppeld zijn aan projecten
SELECT COUNT(*) FROM hours WHERE SUBSTR(date, 1, 4) = '2025' AND offerprojectbase_id IS NOT NULL;
