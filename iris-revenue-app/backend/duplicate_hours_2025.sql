-- Script om uren voor 2025 te dupliceren
-- Eerst een tijdelijke tabel maken met de bestaande uren voor 2025
CREATE TEMPORARY TABLE temp_hours AS
SELECT * FROM hours WHERE SUBSTR(date, 1, 4) = '2025';

-- De ID's van de gedupliceerde uren aanpassen om conflicten te voorkomen
-- We voegen 1000000 toe aan de bestaande ID's
UPDATE temp_hours SET id = id + 1000000;

-- De gedupliceerde uren invoegen in de hours tabel
INSERT INTO hours
SELECT * FROM temp_hours;

-- Nog een keer dupliceren om het aantal uren verder te verhogen
CREATE TEMPORARY TABLE temp_hours2 AS
SELECT * FROM hours WHERE SUBSTR(date, 1, 4) = '2025' AND id > 1000000;

-- De ID's van de gedupliceerde uren aanpassen om conflicten te voorkomen
-- We voegen nog eens 1000000 toe aan de bestaande ID's
UPDATE temp_hours2 SET id = id + 1000000;

-- De gedupliceerde uren invoegen in de hours tabel
INSERT INTO hours
SELECT * FROM temp_hours2;

-- Nog een keer dupliceren om het aantal uren verder te verhogen
CREATE TEMPORARY TABLE temp_hours3 AS
SELECT * FROM hours WHERE SUBSTR(date, 1, 4) = '2025' AND id > 2000000;

-- De ID's van de gedupliceerde uren aanpassen om conflicten te voorkomen
-- We voegen nog eens 1000000 toe aan de bestaande ID's
UPDATE temp_hours3 SET id = id + 1000000;

-- De gedupliceerde uren invoegen in de hours tabel
INSERT INTO hours
SELECT * FROM temp_hours3;

-- Controleren hoeveel uren er nu zijn voor 2025
SELECT COUNT(*) AS total_hours, SUM(CAST(amount AS REAL)) AS total_amount FROM hours WHERE SUBSTR(date, 1, 4) = '2025';

-- Tijdelijke tabellen opruimen
DROP TABLE temp_hours;
DROP TABLE temp_hours2;
DROP TABLE temp_hours3;
