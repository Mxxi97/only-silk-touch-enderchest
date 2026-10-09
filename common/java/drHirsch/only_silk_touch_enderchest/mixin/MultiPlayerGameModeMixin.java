package drHirsch.only_silk_touch_enderchest.mixin;

import drHirsch.only_silk_touch_enderchest.SilkTouch;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.MultiPlayerGameMode;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.sounds.SoundEvents;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * The one hook, shared by all three loaders. startDestroyBlock is where the
 * client begins mining a block and tells the server about it; bailing out at
 * the head means no animation, no packet, and so nothing for the server to
 * break. That is what makes the mod client-only: the server never hears of
 * the attempt.
 *
 * continueDestroyBlock needs no hook of its own. It only makes progress on a
 * target that startDestroyBlock accepted, and falls back to startDestroyBlock
 * whenever the block or the held item changes -- so swapping away from the
 * Silk Touch tool mid-mine lands here again.
 *
 * A mixin rather than each loader's events because the loaders' client-side
 * click events differ from each other and across the supported range, while
 * this method's name and signature have not moved.
 */
@Mixin(MultiPlayerGameMode.class)
public class MultiPlayerGameModeMixin {

    /**
     * Feedback is a sound rather than an action-bar message because the player
     * message API was renamed inside the supported range, which would cost the
     * one-jar-per-loader guarantee. Player.playSound has not moved.
     */
    @Unique
    private long lastRefusal;

    @Inject(method = "startDestroyBlock", at = @At("HEAD"), cancellable = true)
    private void onlySilkTouchEnderchest$refuse(BlockPos pos, Direction face, CallbackInfoReturnable<Boolean> cir) {
        Minecraft minecraft = Minecraft.getInstance();
        if (minecraft.level != null
                && SilkTouch.shouldPreventBreaking(minecraft.player, minecraft.level.getBlockState(pos))) {
            // Holding the button lands here every tick, so only a refusal that
            // follows a pause -- a fresh click -- gets the sound.
            long now = System.currentTimeMillis();
            if (now - lastRefusal > 250) {
                minecraft.player.playSound(SoundEvents.VILLAGER_NO, 1.0F, 1.0F);
            }
            lastRefusal = now;
            cir.setReturnValue(false);
        }
    }
}
