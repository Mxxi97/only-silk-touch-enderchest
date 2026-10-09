package drHirsch.only_silk_touch_enderchest;

import net.minecraft.core.Holder;
import net.minecraft.core.component.DataComponents;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.enchantment.Enchantment;
import net.minecraft.world.item.enchantment.Enchantments;
import net.minecraft.world.item.enchantment.ItemEnchantments;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;

/**
 * The rule. The client mixin in the mixin package asks
 * {@link #shouldPreventBreaking} before it lets the player start mining.
 *
 * This directory is added as an extra source root by all three loader builds
 * (see the `srcDir '../common/java'` line in each build.gradle), so the rule
 * itself exists exactly once and cannot drift between loaders. It only
 * references Minecraft classes, which all three have on the compile classpath
 * under the same official Mojang names.
 *
 * API choice matters here: the enchantment is read straight off the item's
 * ENCHANTMENTS data component rather than through EnchantmentHelper. The helper
 * needs a registry lookup (Holder) for Silk Touch, and the method that produces
 * one was renamed between Minecraft 1.21.4 and 1.21.5
 * (registryOrThrow -> lookupOrThrow), which would have forced a per-version
 * source overlay. The component route uses only API that has been stable since
 * data components landed in 1.20.5.
 */
public final class SilkTouch {
    public static final String MOD_ID = "only_silk_touch_enderchest";

    private SilkTouch() {
    }

    /**
     * True when this break attempt should be refused: an ender chest, mined by a
     * survival player whose held tool has no Silk Touch.
     *
     * Creative is deliberately exempt. Instant-breaking is how you clean up in
     * creative, and a creative player cannot lose an ender chest they can get
     * back from the inventory anyway.
     */
    public static boolean shouldPreventBreaking(Player player, BlockState state) {
        if (!state.is(Blocks.ENDER_CHEST)) {
            return false;
        }
        if (player == null || player.getAbilities().instabuild) {
            return false;
        }
        return !hasSilkTouch(player.getMainHandItem());
    }

    /**
     * Any level of Silk Touch counts. Vanilla only has level 1, but a datapack
     * or another mod can raise the max level, and "level 2 does not count"
     * would be a surprising way to lose an ender chest.
     */
    private static boolean hasSilkTouch(ItemStack stack) {
        ItemEnchantments enchantments = stack.getOrDefault(DataComponents.ENCHANTMENTS, ItemEnchantments.EMPTY);
        for (Holder<Enchantment> enchantment : enchantments.keySet()) {
            if (enchantment.is(Enchantments.SILK_TOUCH)) {
                return true;
            }
        }
        return false;
    }
}
