-- Wave 47 brand refresh: product branch display names move from the
-- "VERIDIAN AI <PRODUCT>" pattern to the "VERI <PRODUCT> AI" pattern the
-- platform now uses everywhere ("VERIDIAN AI" is the platform/company name,
-- caps-always like NVIDIA; individual products are named "VERI <X> AI").

UPDATE compliance.product_branches SET display_name = 'VERI GRC AI' WHERE branch_key = 'grc';
UPDATE compliance.product_branches SET display_name = 'VERI PROJECTS AI' WHERE branch_key = 'pms';
