-- Update dog-friendly airport notes with compelling pilot-and-dog copy
-- Run this in: app.supabase.com → SQL Editor → New query → Run

UPDATE dog_friendly_airports SET dog_notes = 'Your pup can stretch their legs on a dedicated pet area with shade and water while you soak in AirVenture. Dogs welcome on the grounds.' WHERE airport_icao = 'KOSH';
UPDATE dog_friendly_airports SET dog_notes = 'Land on the California coast and walk your dog along grassy ramp-side areas. FBO crew loves meeting four-legged copilots.' WHERE airport_icao = 'KSBA';
UPDATE dog_friendly_airports SET dog_notes = 'Touch down with mountain views and let your dog run free on wide-open fields next to the GA ramp. Big sky country at its best.' WHERE airport_icao = 'KBZN';
UPDATE dog_friendly_airports SET dog_notes = 'Fly into the Tetons and give your dog the mountain adventure they deserve. Grassy areas with jaw-dropping views right off the ramp.' WHERE airport_icao = 'KJAC';
UPDATE dog_friendly_airports SET dog_notes = 'Red rock desert views and paved walkways make this a unique fly-in for you and your dog. FBO keeps water bowls out year-round.' WHERE airport_icao = 'KSEZ';
UPDATE dog_friendly_airports SET dog_notes = 'Big grassy patch on the GA side for your pup. Grab the crew car and hit one of Fresno''s dog parks — they''re everywhere.' WHERE airport_icao = 'KFAT';
UPDATE dog_friendly_airports SET dog_notes = 'Ocean air, grassy median by the ramp, and one of the best post-flight dog walks in all of GA. Your copilot will thank you.' WHERE airport_icao = 'KMRY';
UPDATE dog_friendly_airports SET dog_notes = 'Clean grass area steps from the FBO with water inside. Quick SoCal hop that''s easy on you and your dog.' WHERE airport_icao = 'KHHR';
