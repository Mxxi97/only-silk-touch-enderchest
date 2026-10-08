package drHirsch.only_silk_touch_enderchest;

import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.player.PlayerBlockBreakEvents;

/**
 * Fabric entry point. The rule itself lives in {@link SilkTouch} under
 * common/java and is shared with the NeoForge and Forge builds.
 *
 * Unlike the other two loaders, Fabric's block-break API has not moved across
 * the supported range, so there is no overlay under src/versions here.
 *
 * BEFORE runs on both sides and returning false vetoes the break, so the client
 * never starts the break animation for a chest it is not allowed to mine.
 */
public class OnlySilkTouchEnderchest implements ModInitializer {

    @Override
    public void onInitialize() {
        PlayerBlockBreakEvents.BEFORE.register((level, player, pos, state, blockEntity) ->
                !SilkTouch.shouldPreventBreaking(player, state));
    }
}
