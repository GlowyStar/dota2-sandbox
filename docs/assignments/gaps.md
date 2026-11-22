# Assignment gaps (first 31 heroes)

Files you own (the only files you may edit): `src/scripts/heroes_1.mjs`, `heroes_2.mjs`, `heroes_3.mjs`, `heroes_4.mjs`

## Abilities without a script

- **bristleback**: bristleback_hairball
- **crystal_maiden**: crystal_maiden_crystal_clone
- **dragon_knight**: dragon_knight_fireball
- **drow_ranger**: drow_ranger_glacier
- **faceless_void**: faceless_void_time_walk_reverse
- **life_stealer**: life_stealer_infest, life_stealer_consume
- **medusa**: medusa_cold_blooded
- **necrolyte**: necrolyte_death_seeker
- **ogre_magi**: ogre_magi_unrefined_fireblast, ogre_magi_smash | summoned-unit abilities: ogre_magi_frost_armor [neutral_ogre_magi]
- **phantom_assassin**: phantom_assassin_fan_of_knives
- **skeleton_king**: skeleton_king_bone_guard | summoned-unit abilities: skeleton_king_bone_guard_damage_tracker [wraith_king_skeleton_warrior]
- **slark**: slark_depth_shroud
- **sniper**: sniper_concussive_grenade
- **terrorblade**: terrorblade_demon_zeal, terrorblade_terror_wave
- **viper**: viper_nose_dive
- **zuus**: zuus_cloud, zuus_lightning_hands

## Abilities currently marked partial or n/a (improve where the tooltip allows)

- antimage: antimage_counterspell (partial: passive magic resistance exact; active blocks targeted spells but does not reflect them and is only cast when listed in ai.order)
- bristleback: bristleback_bristleback (partial: damage reduction needs facing: every hit is treated as frontal (no reduction, no passive quills)); bristleback_prickly (n/a: needs facing (enemies behind Bristleback))
- chaos_knight: chaos_knight_armageddon (n/a: movement-only innate); chaos_knight_armageddons_flank_end (n/a: movement-only innate)
- crystal_maiden: crystal_maiden_freezing_field_stop (n/a: )
- faceless_void: faceless_void_distortion_field (n/a: projectile slow not modelled (the modifier only records recent damage for Time Walk))
- huskar: huskar_blood_magic (n/a: Huskar has no mana; item mana costs are not converted to health)
- lion: lion_to_hell_and_back (n/a: triggers on hero kills / assists)
- necrolyte: necrolyte_sadist (n/a: triggers on kills)
- phantom_assassin: phantom_assassin_blur (n/a: stealth / vision effect, no combat numbers)
- spectre: spectre_reality (n/a: teleport to an illusion; positioning only)
- troll_warlord: troll_warlord_whirling_axes_ranged (n/a: ranged stance only; melee stance is assumed)
