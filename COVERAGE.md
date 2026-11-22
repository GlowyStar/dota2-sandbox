# Coverage

Generated from game build 6983 (Nov 18 2026) by `simlab coverage --write`. Do not edit by hand.

Labels:

- **full**: every clause of the tooltip is modelled; a note only states an interpretation or a usage assumption
- **approx**: every clause is present, with simplified geometry or timing, or with a stated assumption
- **partial**: at least one clause of the tooltip is missing (the note says which)
- **n/a**: no meaning in an arena fight (economy, map movement, vision, helper buttons)

## Summary

| Content | Total | Breakdown |
|---|---|---|
| Heroes | 127 | 127 have a script for every ability; base stats, growth and attacks are exact for all |
| Hero abilities | 790 | full 300, approx 424, partial 25, n/a 41, not modelled 0 |
| Hero talents | 1016 | 1014 applied, 2 without effect |
| Shop items | 190 | full 71, approx 42, partial 5, n/a 13, plain stat bonuses 59, not modelled 0 |
| Neutral items and enchantments (current pool) | 67 | full 29, approx 25, partial 6, n/a 3, plain stat bonuses 4, not modelled 0 |
| Creep and summon abilities | 202 | full 81, approx 64, partial 15, n/a 42, not modelled 0 |

Not part of the simulator at all: map, terrain, trees, fog of war and vision, gold and experience, respawn, buildings behaviour, couriers, runes on a timer.

## Heroes

| Hero | Abilities (label shown unless full) | Talents without effect |
|---|---|---|
| Abaddon | Mist Coil (approx), Aphotic Shield, Curse of Avernus, Withering Mist, Borrowed Time | - |
| Alchemist | Acid Spray, Unstable Concoction (approx), Corrosive Weaponry, Berserk Potion (approx), Greevil's Greed (approx), Chemical Rage (approx), Unstable Concoction Throw (approx) | - |
| Ancient Apparition | Cold Feet, Ice Vortex, Chilling Touch, Bone Chill, Ice Blast (approx), Release (approx) | - |
| Anti-Mage | Mana Break, Blink (approx), Counterspell (approx), Persecutor, Mana Void | - |
| Arc Warden | Flux, Magnetic Field (approx), Spark Wraith (approx), Runic Infusion (approx), Tempest Double (approx) | - |
| Axe | Berserker's Call, Battle Hunger (approx), Counter Helix, Culling Blade, One Man Army | - |
| Bane | Enfeeble (approx), Brain Sap, Nightmare (approx), Fiend's Grip (approx), Nightmare End, Ichor of Nyctasha (approx) | - |
| Batrider | Sticky Napalm (approx), Flamebreak (approx), Firefly (approx), APPLICATION DAMAGE: (n/a), Smoldering Resin (approx), Flaming Lasso (approx) | - |
| Beastmaster | Wild Axes (approx), Summon Razorback (approx), Summon Raptors (approx), Inner Beast, Summon Ancient Thunderhide (approx), Primal Roar (approx) | - |
| Bloodseeker | Bloodrage, Blood Rite, Thirst (approx), Sanguivore, Rupture (approx) | - |
| Bounty Hunter | Shuriken Toss (approx), Jinada, Shadow Walk, Friendly Shadow, Big Game Hunter (n/a), Track (approx) | special_bonus_unique_bounty_hunter_8 |
| Brewmaster | Thunder Clap, Cinder Brew (approx), Drunken Brawler (approx), Liquid Courage (approx), Primal Split (approx) | - |
| Bristleback | Viscous Nasal Goo, Quill Spray, Bristleback (approx), Hairball, Warpath, Prickly (approx) | - |
| Broodmother | Insatiable Hunger, Spin Web (approx), Incapacitating Bite, Spinner's Snare (approx), Spider's Milk, Spawn Spiderlings | - |
| Centaur Warrunner | Hoof Stomp, Double Edge, Retaliate (approx), Work Horse (approx), Hitch A Ride (approx), Stampede (approx), Horsepower | - |
| Chaos Knight | Chaos Bolt, Reality Rift (approx), Chaos Strike, Ahead, Armageddon (approx), Phantasm, Heel, Armageddon (n/a) | - |
| Chen | Penitence, Holy Persuasion (approx), Divine Favor (approx), Zealot (approx), Hand of God | - |
| Clinkz | Strafe, Searing Arrows, Death Pact (approx), Burning Barrage (approx), Burning Army (approx), Skeleton Walk (approx), Infernal Shred | - |
| Clockwerk | Battery Assault (approx), Power Cogs (partial), Rocket Flare (approx), Overclocking (approx), Jetpack (approx), Hookshot (approx), Armor Power (approx), Jetpack Toggle (n/a) | - |
| Crystal Maiden | Crystal Nova, Frostbite, Arcane Aura, Crystal Clone (approx), Glacial Guard, Freezing Field (approx), Stop Freezing Field (partial) | - |
| Dark Seer | Vacuum (approx), Ion Shell, Surge (approx), Normal Punch (approx), Quick Wit, Wall of Replica (approx) | - |
| Dark Willow | Bramble Maze (approx), Shadow Realm (approx), Cursed Crown, Bedlam (approx), Pixie Dust, Terrorize (approx) | - |
| Dawnbreaker | Starbreaker (approx), Celestial Hammer (approx), Luminosity, Converge (approx), Break of Dawn (partial), Solar Guardian (approx), dawnbreaker_land (n/a) | - |
| Dazzle | Poison Touch (approx), Shallow Grave, Shadow Wave (approx), Through the Realm (approx), Weave, Nothl Projection (approx), End Projection | - |
| Death Prophet | Crypt Swarm, Silence, Spirit Siphon (approx), Witchcraft (approx), Exorcism (approx) | - |
| Disruptor | Thunder Strike (approx), Glimpse (approx), Kinetic Field (approx), Kinetic Fence (approx), Electromagnetic Repulsion (approx), Static Storm | - |
| Doom | Devour (partial), Scorched Earth (approx), Infernal Blade, Devoured Ability (n/a), Devoured Ability (n/a), Doom, Lvl ? Pain (partial) | - |
| Dragon Knight | Breathe Fire (approx), Dragon Tail, Wyrm's Wrath, Fireball, Dragon Blood, Elder Dragon Form | - |
| Drow Ranger | Frost Arrows, Gust (approx), Multishot (approx), Glacier (approx), Precision Aura, Marksmanship | - |
| Earth Spirit | Boulder Smash (approx), Rolling Boulder (approx), Geomagnetic Grip (approx), Stone Remnant (approx), Enchant Remnant (approx), Magnetize (approx) | - |
| Earthshaker | Fissure (approx), Enchant Totem (approx), Aftershock, Echo Slam, Slugger (approx) | - |
| Elder Titan | Echo Stomp (approx), Astral Spirit (approx), Natural Order, Move Astral Spirit, Momentum (approx), Earth Splitter, Return Astral Spirit | - |
| Ember Spirit | Searing Chains, Sleight of Fist (approx), Flame Guard, Activate Fire Remnant (approx), Immolation, Fire Remnant (approx) | - |
| Enchantress | Impetus, Enchant (approx), Nature's Attendants (approx), Sproink (approx), Little Friends, Untouchable (approx), Rabble-Rouser (approx) | - |
| Enigma | Malefice, Demonic Summoning (approx), Midnight Pulse, Event Horizon (approx), Black Hole (approx) | - |
| Faceless Void | Time Walk, Time Dilation, Time Lock, Reverse Time Walk (approx), Distortion Field (approx), Chronosphere (approx) | - |
| Grimstroke | Stroke of Fate (approx), Phantom's Embrace (approx), Ink Swell, Dark Portrait, Soulbind (approx), Ink Trail | - |
| Gyrocopter | Rocket Barrage, Homing Missile (approx), Flak Cannon (approx), Afterburner, Side Gunner (approx), Call Down (approx) | - |
| Hoodwink | Acorn Shot (approx), Bushwhack (approx), Scurry (approx), Decoy (approx), Hunter's Boomerang (approx), Sharpshooter (approx), End Sharpshooter, Mistwoods Wayfarer (partial) | - |
| Huskar | Inner Fire (approx), Burning Spear, Berserker's Blood, Blood Magic, Life Break | - |
| Invoker | Quas (approx), Wex (approx), Exort (approx), Invoked Spell (n/a), Invoked Spell (n/a), Invoke (approx), Cold Snap, Ghost Walk (approx), Tornado (approx), E.M.P., Alacrity, Chaos Meteor (approx), Sun Strike (approx), Forge Spirit (approx), Ice Wall (approx), Deafening Blast (approx) | - |
| Io | Tether (approx), Spirits (approx), Overcharge, Spirits In (n/a), Spirits Out (n/a), Relocate (approx), Break Tether, Equilibrium (approx) | - |
| Jakiro | Dual Breath, Ice Path, Liquid Fire (approx), Liquid Frost (approx), Double Trouble (approx), Macropyre (approx) | - |
| Juggernaut | Blade Fury (approx), Healing Ward (approx), Blade Dance, Bladeform (approx), Omnislash | - |
| Keeper of the Light | Illuminate (approx), Blinding Light (approx), Chakra Magic, Solar Bind (approx), Will-O-Wisp (approx), Spirit Form, Release Illuminate (n/a), Bright Speed | - |
| Kez | Echo Slash (approx), Grappling Claw (approx), Kazurai Katana (approx), Switch Discipline (approx), Raptor Dance (approx), Falcon Rush (approx), Talon Toss, Shodo Sai (approx), Raven's Veil (approx), Cancel | - |
| Kunkka | Torrent, Tidebringer, X Marks the Spot, Admiral's Rum (approx), Tidal Wave (approx), Ghostship (partial), Return | - |
| Largo | Catchy Lick (approx), Frogstomp, Croak of Genius (approx), Encore (approx), Amphibian Rhapsody (approx), Bullbelly Blitz (approx), Hotfeet Hustle (approx), Island Elixir (approx) | - |
| Legion Commander | Overwhelming Odds, Press The Attack, Moment of Courage, Outfight Them!, Duel | - |
| Leshrac | Split Earth, Diabolic Edict, Lightning Storm, Nihilism, Defilement, Pulse Nova (approx) | - |
| Lich | Frost Blast, Frost Shield, Sinister Gaze (approx), Ice Spire (approx), Sacrifice, Chain Frost | - |
| Lifestealer | Rage, Open Wounds, Feast, Ghoul Frenzy, Infest (partial), Consume (approx) | - |
| Lina | Dragon Slave (approx), Light Strike Array, Fiery Soul, Flame Cloak, Slow Burn, Laguna Blade | - |
| Lion | Earth Spike (approx), Hex, Mana Drain (approx), To Hell and Back, Finger of Death (approx) | - |
| Lone Druid | Entangle (approx), Spirit Link, Savage Roar (approx), Summon Spirit Bear (approx), True Form | - |
| Luna | Lucent Beam, Lunar Orbit (approx), Moon Glaives (approx), Lunar Blessing, Eclipse | - |
| Lycan | Summon Wolves (approx), Howl, Feral Impulse (approx), Wolf Bite (approx), Pack Hunter (approx), Shapeshift (approx) | - |
| Magnus | Shockwave (approx), Empower, Skewer (approx), Horn Toss (approx), Solid Core (partial), Reverse Polarity (approx) | - |
| Marci | Dispose (approx), Rebound (partial), Bodyguard (approx), Special Delivery (n/a), Unleash (approx) | - |
| Mars | Spear of Mars (approx), God's Rebuke (approx), Bulwark (approx), Dauntless (approx), Arena Of Blood (approx) | - |
| Medusa | Split Shot, Mystic Snake (approx), Gorgon's Grasp (approx), Cold Blooded (approx), Mana Shield (approx), Stone Gaze (approx) | - |
| Meepo | Earthbind, Poof (approx), Ransack, Dig (approx), Geomancy (n/a), Divided We Stand (partial), Fling (approx) | - |
| Mirana | Starstorm (approx), Sacred Arrow (approx), Leap (approx), Celestial Quiver, Moonlight Shadow | - |
| Monkey King | Boundless Strike (approx), Tree Dance (n/a), Primal Spring (approx), Jingu Mastery (approx), Mischief (approx), Wukong's Command (approx), Spring Early (n/a), Revert Form (approx), Changing of the Guard (approx) | - |
| Morphling | Waveform, Adaptive Strike (approx), Attribute Shift (Agility Gain) (approx), Attribute Shift (Strength Gain) (approx), Morph (approx), Morph Replicate (approx), Ebb and Flow | - |
| Muerta | Dead Shot (approx), The Calling (approx), Gunslinger, Spectral Slug (approx), Pierce the Veil (approx), Supernatural | - |
| Naga Siren | Mirror Image, Ensnare (approx), Rip Tide (approx), Reel In (approx), Eelskin (approx), Song of the Siren, Song of the Siren End | - |
| Nature's Prophet | Sprout (approx), Teleportation (n/a), Nature's Call (approx), Curse of the Oldgrowth, Spirit of the Forest (partial), Wrath of Nature (approx) | - |
| Necrophos | Death Pulse, Ghost Shroud, Heartstopper Aura, Death Seeker (approx), Sadist, Reaper's Scythe | - |
| Night Stalker | Void (approx), Crippling Fear, Midnight Feast (approx), Hunter in the Night, Dark Ascension | - |
| Nyx Assassin | Impale, Mind Flare, Spiked Carapace, Burrow (approx), Scarab Metabolism, Vendetta (approx), Unburrow | - |
| Ogre Magi | Fireblast, Ignite (approx), Bloodlust, Unrefined Fireblast, Fire Shield, Dumb Luck, Multicast (partial) | - |
| Omniknight | Purification, Repel (approx), Hammer of Purity (approx), Degen Aura, Guardian Angel | - |
| Oracle | Fortune's End (approx), Fate's Edict, Purifying Flames, Rain of Destiny (approx), Diviner's Deck (approx), False Promise (approx), Prognosticate (n/a) | - |
| Outworld Destroyer | Arcane Orb, Astral Imprisonment (approx), Objurgation, Essence Flux (approx), Sanity's Eclipse | - |
| Pangolier | Swashbuckle (approx), Shield Crash (approx), Lucky Shot, Roll Up (approx), Rolling Thunder (approx), Stop Rolling (n/a), End Roll Up (n/a), Fortune Favors the Bold (partial) | - |
| Phantom Assassin | Stifling Dagger (approx), Phantom Strike, Blur (approx), Fan of Knives, Immaterial, Coup de Grace | - |
| Phantom Lancer | Spirit Lance, Doppelganger (approx), Phantom Rush (approx), Illusory Armaments (approx), Juxtapose (approx) | - |
| Phoenix | Icarus Dive (approx), Fire Spirits (approx), Sun Ray (approx), Toggle Movement (n/a), Dying Light, Supernova (approx), Launch Fire Spirit (approx), Stop Icarus Dive (n/a), Stop Sun Ray (n/a) | - |
| Primal Beast | Onslaught (approx), Trample (approx), Uproar (approx), Rock Throw (approx), Begin Onslaught, Pulverize, Colossal | - |
| Puck | Illusory Orb (approx), Waning Rift, Phase Shift (approx), Ethereal Jaunt (approx), Puckish (approx), Dream Coil (approx) | - |
| Pudge | Meat Hook (approx), Rot (approx), Meat Shield, Flesh Heap, Dismember (approx) | - |
| Pugna | Nether Blast, Decrepify, Nether Ward (approx), Oblivion Savant (approx), Life Drain (approx) | - |
| Queen of Pain | Shadow Strike, Blink (approx), Scream Of Pain, Succubus, Sonic Wave (approx) | - |
| Razor | Plasma Field (approx), Static Link (approx), Storm Surge (approx), Unstable Current, Eye of the Storm (approx) | - |
| Riki | Smoke Screen (partial), Blink Strike, Tricks of the Trade, Backstab (approx), Cloak and Dagger | - |
| Ringmaster | Tame the Beasts (approx), Escape Act (approx), Impalement Arts (approx), Souvenir Slot (n/a), Spotlight (approx), Wheel of Wonder (approx), Crack (n/a) | - |
| Rubick | Telekinesis (approx), Fade Bolt (approx), Arcane Supremacy, Stolen Spell (n/a), Stolen Spell (n/a), Spell Steal (approx), Telekinesis Land (n/a), rubick_hidden1 (n/a), rubick_hidden2 (n/a), Curiosity (partial), Telekinesis Land (n/a) | - |
| Sand King | Burrowstrike (approx), Sand Storm (approx), Stinger, Caustic Finale, Epicenter | - |
| Shadow Demon | Disruption (approx), Disseminate (approx), Shadow Poison (approx), Shadow Poison Release, Demonic Cleanse (approx), Demonic Purge (approx), Menace | - |
| Shadow Fiend | Shadowraze (approx), Shadowraze (approx), Shadowraze (approx), Feast of Souls, Presence of the Dark Lord, Requiem of Souls (approx), Necromastery | - |
| Shadow Shaman | Ether Shock (approx), Hex, Shackles (approx), Fowl Play (approx), Urnaconda (approx), Mass Serpent Ward (approx) | - |
| Silencer | Arcane Curse, Glaives of Wisdom, Last Word, Suffer In Silence (approx), Global Silence | - |
| Skywrath Mage | Arcane Bolt (approx), Concussive Shot, Ancient Seal, Shield of the Scion, Mystic Flare (approx) | - |
| Slardar | Guardian Sprint, Slithereen Crush, Bash of the Deep, Seaborn Sentinel (approx), Corrosive Haze (approx) | - |
| Slark | Dark Pact, Pounce (approx), Saltwater Shiv, Depth Shroud (approx), Essence Shift, Shadow Dance (approx) | - |
| Snapfire | Scatterblast (approx), Firesnap Cookie (approx), Lil' Shredder (approx), Gobble Up (approx), Spit Out (approx), Mortimer Kisses (approx), Boomstick (approx) | - |
| Sniper | Shrapnel, Headshot (approx), Take Aim, Concussive Grenade (approx), Keen Scope, Assassinate | - |
| Spectre | Spectral Dagger (approx), Shadow Step, Dispersion, Reality (approx), Desolate (approx), Haunt | - |
| Spirit Breaker | Charge of Darkness (approx), Bulldoze, Greater Bash (approx), Planar Pocket (approx), Empowering Haste (approx), Nether Strike (approx) | - |
| Storm Spirit | Static Remnant (approx), Electric Vortex, Overload (approx), Ball Lightning (approx), Galvanized (approx) | - |
| Sven | Storm Hammer (partial), Great Cleave, Warcry, God's Strength, Wrath of God | - |
| Techies | Sticky Bomb (approx), Reactive Tazer, Blast Off!, M.A.D. (approx), Minefield Sign (approx), Proximity Mines (approx), Detonate Tazer, Detonate M.A.D. (approx) | - |
| Templar Assassin | Refraction (partial), Meld (approx), Psi Blades (approx), Trap (approx), Psionic Projection (approx), Psionic Trap (partial), Inner Peace (approx) | - |
| Terrorblade | Reflection, Conjure Image, Metamorphosis, Demon Zeal, Terror Wave (approx), Sunder, Dark Unity | - |
| Tidehunter | Gush (approx), Kraken Shell (approx), Anchor Smash (approx), Dead in the Water (approx), Ravage, Leviathan's Catch (approx) | - |
| Timbersaw | Whirling Death (approx), Timber Chain (approx), Reactive Armor, Flamethrower (approx), Chakram (approx), Return Chakram, Exposure Therapy (n/a) | - |
| Tinker | Laser (approx), March of the Machines (approx), Deploy Turrets (approx), Warp Flare (approx), Keen Conveyance (n/a), Rearm, Eureka! (approx) | - |
| Tiny | Avalanche, Toss (approx), Tree Grab (approx), Tree Volley (approx), Insurmountable, Grow, Tree Throw (approx) | special_bonus_unique_tiny_5 |
| Treant Protector | Nature's Grasp (approx), Leech Seed (approx), Living Armor (approx), Eyes In The Forest (n/a), Nature's Guise (partial), Overgrowth (approx) | - |
| Troll Warlord | Battle Stance (approx), Whirling Axes (Ranged) (approx), Whirling Axes (Melee) (approx), Fervor, Berserker's Rage, Battle Trance (approx) | - |
| Tusk | Ice Shards (partial), Snowball (approx), Tag Team, Drinking Buddies (approx), Walrus Kick (approx), Walrus PUNCH!, Launch Snowball (n/a), Bitter Chill | - |
| Underlord | Firestorm, Pit of Malice, Atrophy Aura, Invading Force (n/a), Fiend's Gate (approx) | - |
| Undying | Decay, Soul Rip (approx), Tombstone (approx), Zombie Bite (approx), Ceaseless Dirge (n/a), Flesh Golem | - |
| Ursa | Earthshock (approx), Overpower, Fury Swipes, Maul, Enrage | - |
| Vengeful Spirit | Magic Missile, Wave of Terror (approx), Vengeance Aura (approx), Retribution (partial), Nether Swap (approx) | - |
| Venomancer | Venomous Gale (approx), Snakebite, Plague Ward (approx), Poison Sting, Noxious Plague (approx) | - |
| Viper | Poison Attack, Nethertoxin (approx), Corrosive Skin, Nosedive (approx), Predator, Viper Strike (approx) | - |
| Visage | Grave Chill, Soul Assumption (approx), Gravekeeper's Cloak (approx), Stone Form (n/a), Silent as the Grave (approx), Summon Familiars (approx), Stone Form (approx) | - |
| Void Spirit | Aether Remnant (partial), Dissimilate (partial), Resonant Pulse, Intrinsic Edge, Astral Step (approx) | - |
| Warlock | Fatal Bonds (approx), Shadow Word, Upheaval (approx), Eldritch Summoning (approx), Chaotic Offering (approx) | - |
| Weaver | The Swarm (approx), Shukuchi (approx), Geminate Attack, Time Lapse (Ally) (approx), Time Lapse (approx), Threads of Fate (approx) | - |
| Windranger | Shackleshot (approx), Powershot (approx), Windrun, Gale Force (approx), Focus Fire Cancel (n/a), Focus Fire, Tailwind | - |
| Winter Wyvern | Arctic Burn (partial), Splinter Blast, Cold Embrace (approx), Eldwurm's Edda (n/a), Winter's Curse (approx) | - |
| Witch Doctor | Paralyzing Cask (approx), Voodoo Restoration, Maledict, Voodoo Switcheroo (approx), Gris-Gris (n/a), Death Ward (approx) | - |
| Wraith King | Wraithfire Blast, Bone Guard (approx), Mortal Strike, Vampiric Spirit, Reincarnation | - |
| Zeus | Arc Lightning, Lightning Bolt (approx), Heavenly Jump (approx), Nimbus (approx), Lightning Hands, Thundergod's Wrath (approx), Static Field | - |

## Partial: a tooltip clause is missing

| Ability | Owner | What is missing or assumed |
|---|---|---|
| Power Cogs (`rattletrap_power_cogs`) | Clockwerk | the cogs are not units: enemies inside cogs_radius at the cast are held inside the ring; an enemy outside is shocked once (damage + mana_burn, plus mana_burn_as_damage_pct of the mana burned, instant push of push_length) when it comes within trigger_distance of the ring, and afterwards cannot walk in until it has stood at the ring for attacks_to_destroy of its own attack intervals. The ring is dropped when Clockwerk leaves it. Overclocked: larger ring, smaller trigger distance, enemies inside that touch it are shocked once towards the centre, and Clockwerk gains bonus_armor_pct armor. NOT modelled: single cogs being attacked or powering down one by one, Clockwerk launching a cog with an attack (projectile_distance), allies being blocked |
| Stop Freezing Field (`crystal_maiden_freezing_field_stop`) | Crystal Maiden | manual only (never auto-cast). It ends the field with Scepter (no channel); a channelling unit accepts no orders in this engine, so a channelled Freezing Field cannot be stopped early |
| Break of Dawn (`dawnbreaker_break_of_dawn`) | Dawnbreaker | bonus base damage (and, with Scepter, the same heal amplification) while it is day, nothing at night: the full max_dmg_pct during Solar Guardian's daylight, 99.8% of it on an ordinary day, which is what the Hero Demo shows (its clock stands still just after sunrise). Missing: the decay of the bonus over the course of a real day (the sandbox has no time of day); the game applies the percentage to each attack roll, the engine to the average base damage, so single attacks differ by up to 0.8; vision does not exist |
| Devour (`doom_bringer_devour`) | Doom | the creep is removed at once and Doom gains its first two non-generic abilities at level 1 until the next Devour that brings abilities; gold is not modelled; alt-cast (no ability gain) is not used. Shard: charges, Ancients and the +spell amplification of devoured abilities are modelled; NOT modelled: the Shard +AoE of devoured abilities (the engine has no per-ability area bonus). Default controller: eats the nearest valid creep within cast range + 350 |
| Lvl ? Pain (`doom_bringer_lvl_pain`) | Doom | the burst has no damage type in the data (DAMAGE_TYPE_NONE): dealt as pure, not amplified; the share is taken from the health Doom actually removed during the curse (including the attack that applied it). NOT modelled: the tooltip note "Also applies to all attacks when Doom is at max level" - it was written for the pre-7.41 version of the innate (bonus damage against lower-level enemies) and the tooltip does not say what it means for the curse |
| Mistwoods Wayfarer (`hoodwink_mistwoods_wayfarer`) | Hoodwink | needs a tree within `radius` of Hoodwink and the sandbox has no natural trees: only a tree planted by Acorn Shot / Decoy can take a redirected attack (it is destroyed; a tree holding a Bushwhack is not used). Redirection next to natural trees, the normal case in the game, is therefore missing and the passive is rarely active |
| Ghostship (`kunkka_ghostship`) | Kunkka | the ship sails ghostship_distance and crashes at the targeted point (at most cast range away); crash radius = ghostship_width; allied heroes the ship comes within ghostship_width of get a rum_factor-strength Admiral's Rum (absorb, speed and duration multiplied). Scepter: the fleet of fleet_count ships fleet_interval apart is modelled; the cannonball volleys are NOT (in Hero Demo a dummy 500 in front of Kunkka took two balls of cannon_ball_damage_pct each per ship, 1.0 and 0.6 s before the crash; the layout of the volleys is not in the data). Default controller: when the crash can cover the predicted target position or, with X Marks the Spot ready, the spot it will be returned to |
| Infest (`life_stealer_infest`) | Lifestealer | hosts: allied heroes and units (host gets the speed and health bonus) and, with Scepter, enemy heroes (one attack per attack_rate_enemy from inside starting at once, forced exit after infest_duration_enemy); heals once per second; the cooldown restarts when he leaves; infesting or controlling enemy and neutral creeps, their health drain and the Shard blood damage from consuming a creep are not modelled; AI: with Scepter enters the enemy hero target below 75% health, otherwise an allied hero within 700 below 35% health, and leaves at 90% health or when the host drops below 30% |
| Solid Core (`magnataur_solid_core`) | Magnus | slow resistance is modelled; the knockback reduction is not (forced movement is applied directly by other scripts, there is no hook to scale it) |
| Rebound (`marci_companion_run`) | Marci | not modelled: the alt-cast that carries the ally along. Modelled: needs another unit to bounce off (an ally; with the Shard also an enemy, including the target itself); the run + lunge is a lock of run distance / move_speed + lob time, then Marci appears at the landing point (her target if within max_jump_distance of the bounce unit) and damages + stuns the landing area; the ally (with the Shard also Marci) gets the speed buff; scepter_heal / scepter_armor values have no tooltip and are not used |
| Divided We Stand (`meepo_divided_we_stand`) | Meepo | clones are real hero units (world.summon) with the same level, skills, talents, Scepter/Shard and items, their own health, mana, cooldowns and fight controller; when any Meepo dies all die; item damage, attack speed, health, mana and regeneration bonuses are cut by dps_penalty_pct on every Meepo. Missing: sharing of item proc chances and mana burn, shared item cooldowns (clones never use active items), experience rules. The Shard pick-up is a cast of this ability (see Fling). Level 4 is applied by the script (engine caps ultimates at 3) at hero level required_level + 3 x levels_between_upgrades |
| Spirit of the Forest (`furion_spirit_of_the_forest`) | Nature's Prophet | only treants near the target are counted (x multiplier); map trees and Sprout trees are not (no terrain, and the number of trees in a Sprout ring is not in the data) |
| Multicast (`ogre_magi_multicast`) | Ogre Magi | applied to Fireblast, Unrefined Fireblast, Ignite, Bloodlust and Fire Shield; targeted items are not multicast |
| Fortune Favors the Bold (`pangolier_fortune_favors_the_bold`) | Pangolier | only critical strikes are covered: a crit rolled by an attacker within aura_radius is cancelled with chance_reduce % probability; other random on-attack effects (bashes, procs) are rolled inside other scripts and cannot be intercepted |
| Smoke Screen (`riki_smoke_screen`) | Riki | silence, miss chance and the Shard armor reduction are applied to enemies while they are inside the cloud (checked every 0.25 s). NOT modelled: Shard "cannot be targeted by their allies" |
| Curiosity (`rubick_curiosity`) | Rubick | damage, area and debuff-duration bonuses are modelled; the buff-duration half is NOT (the engine only amplifies debuff durations; it would lengthen the buffs of stolen spells); every enemy cast in range counts as seen |
| Storm Hammer (`sven_storm_bolt`) | Sven | Scepter: cast range, basic dispel of the target and invulnerable enemies in the area are modelled; the alt-cast (Sven flies with the hammer, +scepter_bonus_damage) is not: the engine has no alt-cast order, and a normal cast neither moves him nor adds the bonus (live); units out of play are not hit; the bonus_damage_pct value belongs to a talent Sven no longer has and is ignored |
| Refraction (`templar_assassin_refraction`) | Templar Assassin | damage instances: bonus damage on the next `instances` attacks; barrier instances: each absorbs shield_per_instance, and a hit larger than what is left is absorbed whole and uses the instance up. Missing: the Shard clause "can be cast while disabled" (the engine does not let disabled units cast) |
| Psionic Trap (`templar_assassin_psionic_trap`) | Templar Assassin | traps are summoned units; beyond max_traps the oldest one disappears. Missing: enemies can never see or destroy a trap (the tooltip gives traps pips that attacks remove once a trap is detected); here they stay untouchable even in worlds with detectAll on, because the default controller attacks the nearest unit and would chase every trap. Sprung: slow from movement_speed_min to movement_speed_max by charge time for trap_duration; a fully charged trap also deals trap_bonus_damage, spread over the slow in damage_tick_rate ticks (the tooltip only says "deals damage after" the charge time); Scepter silence scales the same way. Controller: one trap on the target unless a trap already lies within 60% of the radius |
| Nature's Guise (`treant_natures_guise`) | Treant Protector | in the game Treant has +movement_bonus % speed while a tree is within radius (and walks through trees); the Hero Demo arena has trees, so live Treant runs at 308 instead of 280 in every recorded scene; the sandbox has no trees: only the bonus near his own Nature's Grasp vines (which count as trees) is modelled; tree walking and the invisibility active are not |
| Ice Shards (`tusk_ice_shards`) | Tusk | the ball damages every enemy on its way to the point (half-width shard_width, speed shard_speed). Missing: the barrier does not block movement (no terrain or pathing; it would only matter for units walking away from Tusk). Talent: for shard_duration enemies within shard_distance of the point (inside the ring of shards; shipped patch notes 7.30 / 7.41) are slowed (from the moment the ring forms) and burned every 1 s with the full per-second value (both measured) |
| Retribution (`vengefulspirit_retribution`) | Vengeful Spirit | not modelled: counting as both a melee and a ranged attacker (the engine gives a unit one attack type; she is ranged). The killer is marked and would take bonus_damage% more from her, but that only matters if she returns to life during the simulation (no respawn) |
| Aether Remnant (`void_spirit_aether_remnant`) | Void Spirit | no vector targeting: the remnant watches the strip from its landing point away from the caster (watch distance x watch radius, live); the first unit in it is damaged, silenced, disarmed and muted for pull_duration and walks pull_destination% of the way to the remnant at a fixed speed (live), which spends the remnant; the remnant is not a unit; AI lands it 200 units in front of its target; Shard: creeps in the path take creep_damage_pct of the damage per second instead of triggering it, but the second, rotating path is NOT modelled (the unit of rotation_speed is unknown); its True Sight is not modelled either (it only matters when a scenario turns rules.detectAll off) |
| Dissimilate (`void_spirit_dissimilate`) | Void Spirit | Void Spirit is out of play for phase_duration, then leaves through the central portal or one of the ring portals (the ring is turned so that one portal points at his target) and damages around it; the exit is the portal that catches most enemies; the "Outer Dissimilate Ring" talent is NOT modelled (the outer ring's geometry is not in the data) |
| Arctic Burn (`winter_wyvern_arctic_burn`) | Winter Wyvern | bonus attack range and projectile speed; every attack applies the burn (percent_damage % of current health per second in tick_rate ticks, magical) and slow for damage_duration, not on Roshan. Scepter (measured): no cooldown, lasts `duration`, adds movement speed; the tooltip's toggle with a mana drain (mana_cost_scepter) was not seen in the game and is not modelled. Missing: the attack point reduction to attack_point (no engine stat) and flying movement (no terrain); max_attacks has no tooltip text and is not applied |
| Linken's Sphere (`item_sphere`) | shop item | passive Spellblock only; the active Transfer Spellblock is not modelled |
| Essence Distiller (`item_essence_distiller`) | shop item | starts empty; charges come from enemy hero deaths in range or from the scenario (stacks: { <item name>: N }). The data gives no damage type: magical (engine default). 1 s damage ticks. AI: used on the current enemy hero, else on itself below 60% health when no enemy hero hit it for 3 s. True Sight and shared vision on the enemy are not modelled (they only matter with rules.detectAll = false). A ground cast (order with a point and no target) lies dormant and latches onto the first enemy hero that comes into latch range |
| Kaya and Sange (`item_kaya_and_sange`) | shop item | "Mana Cost/Mana Loss Reduction": mana costs are reduced, mana lost to enemy mana burn is not (no engine hook) |
| Yasha and Kaya (`item_yasha_and_kaya`) | shop item | "+% Cast Speed Bonus" is not modelled (the engine has no cast-speed stat) |
| Glimmer Cape (`item_glimmer_cape`) | shop item | magic barrier and movement speed after the fade delay; the invisibility is not modelled. AI: cast on itself when the target is within 900 |
| Mystical (`item_enhancement_mystical`) | neutral item | level 3 "Mana Cost/Mana Loss Reduction": the mana cost half is modelled, mana lost to enemy mana burn is not reduced (no engine hook) |
| Tough (`item_enhancement_tough`) | neutral item | damage and armor are stat tokens; level 3 Knockback Resistance (forced movement from enemies moves the wearer 40% less far, 7.39 notes) is honoured only by Force Staff and Hurricane Pike: the engine's generic knockback has no resistance |
| Dezun Bloodrite (`item_dezun_bloodrite`) | neutral item | the health cost of casts is modelled (item casts included, attack modifiers excluded); the larger area of effect is NOT applied: the engine has a flat radius bonus only, no percentage |
| Stonefeather Satchel (`item_stonefeather_satchel`) | neutral item | movement speed / armor toggle modelled (starts with Feathers, or with Rocks through scenario stacks: { item_stonefeather_satchel: 1 }; AI holds Rocks while in attack reach, Feathers while chasing). The forced-movement distance change is NOT applied, except to this file's Psychic Push: the engine has no such stat |
| Enchanter's Bauble (`item_enchanters_bauble`) | neutral item | raises only the plain stat bonuses of the enchantment (its stat tokens); enchantment effects that are scripted elsewhere are NOT amplified. Number of re-crafts = scenario stacks: { item_enchanters_bauble: n }, 0 (first craft) by default |
| Manic (`item_enhancement_manic`) | neutral item | base attack time reduction is modelled; "+20% Cast Speed Bonus" is not (the engine has no cast-speed stat); vision has no effect in the sandbox |
| filler_ability (`filler_ability`) | creep / summon | not modelled: no tooltip; the values describe an area heal of the "healer" buildings (hp_heal / mp_heal plus a % of the maximum per second for duration, in radius, on a long cooldown) but nothing in the data says what triggers it |
| ability_scout_bonuses (`ability_scout_bonuses`) | creep / summon | not modelled: no tooltip; the health / armor growth (increase_health, increase_armor up to max_health, max_armor) has no interval in the data, reveal_radius is vision |
| Strength of the Immortal (`roshan_devotion`) | creep / summon | slow resistance only. The damage reduction against attacking illusions has no value in the data and is not modelled; the magic resistance is part of the unit and the armor growth is in roshan_inherent_buffs |
| miniboss_minion_deflecting_shield (`miniboss_minion_deflecting_shield`) | creep / summon | not modelled: no tooltip; the values describe an aura barrier (max_barrier_pct_max_health % of max health, damage_reflection_pct % reflection) but not who receives it or which damage it blocks |
| roshan_halloween_apocalypse (`roshan_halloween_apocalypse`) | creep / summon | not modelled: no tooltip in the game files: the values (area_of_effect, delay, damage) do not say where the blasts land |
| roshan_halloween_wave_of_force (`roshan_halloween_wave_of_force`) | creep / summon | no tooltip in the game files: AbilityDamage to enemies in radius when the wave (speed) reaches them; what duration and mana_burn do is not defined and not modelled (game_end_* are event rules) |
| roshan_halloween_toss (`roshan_halloween_toss`) | creep / summon | not modelled: no tooltip in the game files: the values do not say which unit is grabbed and thrown |
| roshan_halloween_burn (`roshan_halloween_burn`) | creep / summon | not modelled: no tooltip in the game files: the values (projectile_count, rotation_angle, damage) do not define the sweep or how often a unit is hit |
| roshan_halloween_fireball (`roshan_halloween_fireball`) | creep / summon | not modelled: no tooltip in the game files: damage_percent has no stated base and the targets are not defined |
| roshan_halloween_summon (`roshan_halloween_summon`) | creep / summon | not modelled: no tooltip in the game files: neither the summoned unit nor its count is in the ability data |
| greevil_miniboss_black_nightmare (`greevil_miniboss_black_nightmare`) | creep / summon | not modelled: no tooltip, and the values (AbilityDuration vs duration, AbilityDamage, nightmare_invuln_time) do not define the sleep, damage and wake-up rules |
| greevil_miniboss_black_brain_sap (`greevil_miniboss_black_brain_sap`) | creep / summon | no tooltip in the game files: modelled from the value names only (AbilityDamage as pure damage); the heal that the name suggests is not in the data and not modelled |
| greevil_miniboss_yellow_surge (`greevil_miniboss_yellow_surge`) | creep / summon | not modelled: no tooltip, and the only value is a duration (the speed it grants is not in the data) |
| greevil_miniboss_white_purification (`greevil_miniboss_white_purification`) | creep / summon | no tooltip in the game files: modelled from the value names only (heal); the pure damage around the target that damage type and radius suggest has no amount in the data and is not modelled |
| greevil_miniboss_white_degen_aura (`greevil_miniboss_white_degen_aura`) | creep / summon | no tooltip in the game files: modelled from the value names only: speed_bonus is applied to movement speed; whether attack speed is reduced as well is not stated |

## Not applicable in an arena fight

| Ability | Owner | What is missing or assumed |
|---|---|---|
| APPLICATION DAMAGE: (`batrider_sticky_napalm_application_damage`) | Batrider | internal damage source of Sticky Napalm's application damage, which is dealt by the Sticky Napalm script |
| Big Game Hunter (`bounty_hunter_big_game_hunter`) | Bounty Hunter | gold bonus only |
| Heel, Armageddon (`chaos_knight_armageddons_flank_end`) | Chaos Knight | sub-ability that stops the Ahead, Armageddon charge early; the AI always finishes the charge |
| Jetpack Toggle (`rattletrap_jetpack_toggle`) | Clockwerk | helper that toggles Jetpack; switching off is done by the Jetpack script itself |
| dawnbreaker_land (`dawnbreaker_land`) | Dawnbreaker | internal helper of Solar Guardian (the landing is part of that script); it has no tooltip |
| Devoured Ability (`doom_bringer_empty1`) | Doom | placeholder slot; devoured abilities are added to Doom directly |
| Devoured Ability (`doom_bringer_empty2`) | Doom | placeholder slot; devoured abilities are added to Doom directly |
| Invoked Spell (`invoker_empty1`) | Invoker | placeholder slot for an invoked spell |
| Invoked Spell (`invoker_empty2`) | Invoker | placeholder slot for an invoked spell |
| Spirits In (`wisp_spirits_in`) | Io | toggle helper: the Spirits script steers the orbit radius towards the current target by itself (min_range .. max_range at spirit_movement_rate) |
| Spirits Out (`wisp_spirits_out`) | Io | toggle helper: the Spirits script steers the orbit radius towards the current target by itself (min_range .. max_range at spirit_movement_rate) |
| Release Illuminate (`keeper_of_the_light_illuminate_end`) | Keeper of the Light | early-release helper of Illuminate; the default controller always channels to the end |
| Special Delivery (`marci_special_delivery`) | Marci | courier ability (economy) |
| Geomancy (`meepo_geomancy`) | Meepo | terrain bonuses (dirt, trees, water): the sandbox has no terrain, so none of them applies. [L] measured in Hero Demo: on the arena ground Meepo keeps his base 310 speed with and without a clone |
| Tree Dance (`monkey_king_tree_dance`) | Monkey King | jumping between trees is map movement and the sandbox has no trees; the modifier only records when Monkey King was last damaged by a hero or a player-controlled unit (jump_damage_cooldown), which gates Primal Spring |
| Spring Early (`monkey_king_primal_spring_early`) | Monkey King | helper that releases Primal Spring early; the spring is always fully channelled |
| Teleportation (`furion_teleportation`) | Nature's Prophet | map movement (3 s cast, global teleport); it has no combat values since the barrier was removed |
| Prognosticate (`oracle_prognosticate`) | Oracle | rune and Roshan timer announcements; no combat effect |
| Stop Rolling (`pangolier_gyroshell_stop`) | Pangolier | ends Rolling Thunder early; the roll always lasts its duration (or until Swashbuckle is cast) |
| End Roll Up (`pangolier_rollup_stop`) | Pangolier | ends Roll Up early; it always lasts its duration |
| Toggle Movement (`phoenix_sun_ray_toggle_move`) | Phoenix | toggles slow forward movement during Sun Ray; Phoenix stays in place while firing |
| Stop Icarus Dive (`phoenix_icarus_dive_stop`) | Phoenix | cancels the dive early; the dive always runs its full course here |
| Stop Sun Ray (`phoenix_sun_ray_stop`) | Phoenix | stops Sun Ray early; the ray always runs until it ends or is interrupted |
| Souvenir Slot (`ringmaster_empty_souvenir`) | Ringmaster | souvenir slot: souvenirs come from enemy hero deaths and their abilities are not in this hero's ability list of the data pack |
| Crack (`ringmaster_tame_the_beasts_crack`) | Ringmaster | early-release helper of Tame the Beasts; the whip is always channelled to the end |
| Stolen Spell (`rubick_empty1`) | Rubick | placeholder slot for a stolen spell |
| Stolen Spell (`rubick_empty2`) | Rubick | placeholder slot for a stolen spell |
| Telekinesis Land (`rubick_telekinesis_land`) | Rubick | landing-point picker; the Telekinesis script chooses the spot itself |
| rubick_hidden1 (`rubick_hidden1`) | Rubick | placeholder slot |
| rubick_hidden2 (`rubick_hidden2`) | Rubick | placeholder slot |
| Telekinesis Land (`rubick_telekinesis_land_self`) | Rubick | landing-point picker; the Telekinesis script chooses the spot itself |
| Exposure Therapy (`shredder_exposure_therapy`) | Timbersaw | triggers on destroyed trees; the sandbox has no trees |
| Keen Conveyance (`tinker_keen_teleport`) | Tinker | teleport to a friendly structure / unit: map movement |
| Eyes In The Forest (`treant_eyes_in_the_forest`) | Treant Protector | vision ward in a tree; no trees or vision in the sandbox |
| Launch Snowball (`tusk_launch_snowball`) | Tusk | launch helper of Snowball; the default controller launches the snowball the moment it is cast |
| Invading Force (`abyssal_underlord_raid_boss`) | Underlord | triggers when an allied hero teleports; there is no teleporting in the sandbox |
| Ceaseless Dirge (`undying_ceaseless_dirge`) | Undying | respawn in the fountain: the hero still leaves the fight, so nothing changes inside the sandbox |
| Stone Form (`visage_stone_form_self_cast`) | Visage | order relay to the nearest familiar; familiars use Stone Form through their own AI |
| Focus Fire Cancel (`windrunner_focusfire_cancel`) | Windranger | cancel helper; the controller keeps Focus Fire for its full duration |
| Eldwurm's Edda (`winter_wyvern_eldwurms_edda`) | Winter Wyvern | progression item: the player decides when to consume it and which basic ability gets +1 level (the data has no values for a fifth level) together with +25% base Intelligence; none of it is applied in the sandbox |
| Gris-Gris (`witch_doctor_gris_gris`) | Witch Doctor | gold item (economy); no combat effect |
| Iron Branch (`item_branches`) | shop item | utility item, no combat effect modelled |
| Gem of True Sight (`item_gem`) | shop item | utility item, no combat effect modelled |
| Clarity (`item_clarity`) | shop item | utility item, no combat effect modelled |
| Blood Grenade (`item_blood_grenade`) | shop item | utility item, no combat effect modelled |
| Healing Salve (`item_flask`) | shop item | utility item, no combat effect modelled |
| Dust of Appearance (`item_dust`) | shop item | utility item, no combat effect modelled |
| Bottle (`item_bottle`) | shop item | utility item, no combat effect modelled |
| Sentry Ward (`item_ward_sentry`) | shop item | utility item, no combat effect modelled |
| Tango (`item_tango`) | shop item | utility item, no combat effect modelled |
| Town Portal Scroll (`item_tpscroll`) | shop item | utility item, no combat effect modelled |
| Hand of Midas (`item_hand_of_midas`) | shop item | utility item, no combat effect modelled |
| Helm of the Dominator (`item_helm_of_the_dominator`) | shop item | utility item, no combat effect modelled |
| Smoke of Deceit (`item_smoke_of_deceit`) | shop item | utility item, no combat effect modelled |
| Dormant Curio (`item_dormant_curio`) | neutral item | acts only when the next artifact is crafted; its result is the Unleashed enchantment (item_enhancement_curious), which the artifacts of this file honour when their owner carries it |
| Forager's Kit (`item_foragers_kit`) | neutral item | foraging trees on the map for consumables and gold: map and economy |
| Red Ledger (`item_red_ledger`) | neutral item | gold bounties for hero kills: economy only |
| Backdoor Protection (`backdoor_protection`) | creep / summon | map mechanic |
| Backdoor Protection (`backdoor_protection_in_base`) | creep / summon | map mechanic |
| ability_lotus_pool (`ability_lotus_pool`) | creep / summon | map object: Healing Lotus pickup (economy) |
| Prospecting Aura (`kobold_tunneler_prospecting`) | creep / summon | gold per minute aura (economy) |
| Retrieve Items (`courier_take_stash_items`) | creep / summon | courier order (item delivery / shop / stash) |
| Go To Secret Shop (`courier_go_to_secretshop`) | creep / summon | courier order (item delivery / shop / stash) |
| Return Items (`courier_return_stash_items`) | creep / summon | courier order (item delivery / shop / stash) |
| Speed Burst (`courier_burst`) | creep / summon | courier ability (speed burst); couriers take no part in combat here |
| Transfer Items (`courier_transfer_items`) | creep / summon | courier order (item delivery / shop / stash) |
| Shield (`courier_shield`) | creep / summon | courier ability (protective shield); couriers take no part in combat here |
| courier_morph (`courier_morph`) | creep / summon | courier order (item delivery / shop / stash) |
| courier_take_stash_and_transfer_items (`courier_take_stash_and_transfer_items`) | creep / summon | courier order (item delivery / shop / stash) |
| courier_transfer_items_to_other_player (`courier_transfer_items_to_other_player`) | creep / summon | courier order (item delivery / shop / stash) |
| courier_go_to_enemy_secretshop (`courier_go_to_enemy_secretshop`) | creep / summon | courier order (item delivery / shop / stash) |
| courier_go_to_sideshop (`courier_go_to_sideshop`) | creep / summon | courier order (item delivery / shop / stash) |
| courier_go_to_sideshop2 (`courier_go_to_sideshop2`) | creep / summon | courier order (item delivery / shop / stash) |
| Auto Deliver (`courier_autodeliver`) | creep / summon | courier order (item delivery / shop / stash) |
| Return to Base (`courier_return_to_base`) | creep / summon | courier order (item delivery / shop / stash) |
| +{s:bonus_duration}s Strafe Duration (`special_bonus_unique_clinkz_1`) | creep / summon | talent slot copied onto the Skeleton Archer: it changes the duration of Strafe (clinkz_strafe), which the archer does not have |
| miniboss_inherent_buffs (`miniboss_inherent_buffs`) | creep / summon | hidden passive without values or tooltip (the game-time scaling is modelled inside the Tormentor's other abilities) |
| miniboss_minion_following_movement (`miniboss_minion_following_movement`) | creep / summon | movement helper without values |
| gyrocopter_side_gunner (`gyrocopter_side_gunner`) | creep / summon | marker passive of the Side Gunner unit (no values, no tooltip); the gunner is scripted on Gyrocopter as gyrocopter_side_gunner_spawn_ability and the unit is not spawned |
| roshan_halloween_levels (`roshan_halloween_levels`) | creep / summon | stat bonuses driven by Diretide event state (boss level), which does not exist here; no tooltip |
| roshan_halloween_angry (`roshan_halloween_angry`) | creep / summon | stat bonuses driven by Diretide event state (the boss getting angry), which does not exist here; no tooltip |
| roshan_halloween_candy (`roshan_halloween_candy`) | creep / summon | stat bonuses driven by Diretide event state (candy fed to the boss), which does not exist here; no tooltip |
| generic_hidden (`generic_hidden`) | creep / summon |  |
| Primal Split Cancel (`brewmaster_primal_split_cancel`) | creep / summon | cancel helper; the controller never ends Primal Split early |
| Spell Immunity (`neutral_spell_immunity`) | creep / summon | no effect in the live game: no modifier, no immunity state (measured on the tombstone); the tooltip says "most magical spells" |
| Destroy Spin Web (`broodmother_spin_web_destroy`) | creep / summon | manual removal of a web; webs are only removed when the limit is exceeded |
| Return (`lone_druid_spirit_bear_return`) | creep / summon | map movement (teleport back to Lone Druid); a bear beyond the leash range simply walks back |
| Return has No Cooldown and -{s:bonus_AbilityChannelTime}s Channel Time (`special_bonus_unique_lone_druid_spirit_bear_return_cd`) | creep / summon | talent slot that only changes Return (teleport to Lone Druid): map movement |
| Recall Familiar (`visage_summon_familiars_recall`) | creep / summon | returns the familiar to Visage (map movement) |
| greevil_miniboss_sight (`greevil_miniboss_sight`) | creep / summon | vision radius only |
| PINPOINT DETONATE (`techies_remote_mines_self_detonate`) | creep / summon | legacy Remote Mines helper still listed on the Sticky Bomb unit; the Sticky Bomb is modelled without a unit and explodes on its own timer |
| cny_beast_force_attack (`cny_beast_force_attack`) | creep / summon | event unit order helper (picks the Year Beast's attack target); no tooltip |
| cny_beast_teleport (`cny_beast_teleport`) | creep / summon | event unit teleport (map movement); no tooltip |
| treant_lifebomb_explode (`treant_lifebomb_explode`) | creep / summon | no values and no tooltip in the data; the life bomb unit is not created by any current Treant ability |
| Destroy Ofrenda (`muerta_ofrenda_destroy`) | creep / summon | ability of the Ofrenda altar (respawn point choice): no combat effect |
| ability_xp_fountain (`ability_xp_fountain`) | creep / summon | Shrine of Wisdom: experience pickup (economy) |
| ability_launchpad (`ability_launchpad`) | creep / summon | map object that launches units across the map (map movement) |
| High Five (`plus_high_five`) | creep / summon | cosmetic |
| ability_stone_of_recall (`ability_stone_of_recall`) | creep / summon | map object: teleport target (map movement) |

## Not modelled

None.

## Notes on approximated abilities

Every approximation is stated per ability. Ask for one hero with `simlab coverage <hero>` or the MCP tool `sim_coverage` (`hero` argument) to read the notes of its abilities.

## Items that are plain stat bonuses (exact, no script needed)

Blades of Attack, Broadsword, Chainmail, Splintmail, Claymore, Helm of Iron Will, Mithril Hammer, Platemail, Quarterstaff, Wind Lace, Ring of Protection, Gauntlets of Strength, Slippers of Agility, Mantle of Intelligence, Belt of Strength, Band of Elvenskin, Robe of the Magi, Circlet, Crown, Diadem, Ogre Axe, Blade of Alacrity, Staff of Wizardry, Ultimate Orb, Gloves of Haste, Blitz Knuckles, Morbid Mask, Voodoo Mask, Ring of Regen, Sage's Mask, Talisman of Evasion, Demon Edge, Eaglesong, Reaver, Sacred Relic, Hyperstone, Ring of Health, Ring of Tarrasque, Void Stone, Tiara of Selemene, Mystic Staff, Energy Booster, Point Booster, Vitality Booster, Fluffy Hat, Wizard Hat, Oblivion Staff, Perseverance, Aether Lens, Aghanim's Scepter, Aghanim's Blessing, Aghanim's Shard, Soul Booster, Butterfly, Dragon Lance, Yasha, Octarine Core, Falcon Blade, Chasm Stone, Quickened, Brawny, Fleetfooted, Vital
